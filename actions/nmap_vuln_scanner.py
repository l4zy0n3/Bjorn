"""
Vulnerability Scanner Action
Scanne ultra-rapidement CPE (+ CVE via vulners si dispo),
avec fallback "lourd" optionnel.
Affiche une progression en % dans Bjorn.
"""

import re
import time
import nmap
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any

from shared import SharedData
from logger import Logger

logger = Logger(name="NmapVulnScanner.py", level=logging.DEBUG)

b_class = "NmapVulnScanner"
b_module = "nmap_vuln_scanner"
b_status = "NmapVulnScanner"
b_port = None
b_parent = None
b_action = "normal"
b_service = []
b_trigger = "on_port_change"
b_requires = '{"action":"NetworkScanner","status":"success","scope":"global"}'
b_priority = 11
b_cooldown = 0
b_enabled = 1
b_rate_limit = None

# Regex compilé une seule fois (gain CPU sur Pi Zero)
CVE_RE = re.compile(r'CVE-\d{4}-\d{4,7}', re.IGNORECASE)


class NmapVulnScanner:
    """Scanner de vulnérabilités via nmap (mode rapide CPE/CVE) avec progression."""

    def __init__(self, shared_data: SharedData):
        self.shared_data = shared_data
        # Pas de self.nm partagé : on instancie dans chaque méthode de scan
        # pour éviter les corruptions d'état entre batches.
        logger.info("NmapVulnScanner initialized")

    # ---------------------------- Public API ---------------------------- #

    def execute(self, ip: str, port: str, row: Dict, status_key: str) -> str:
        try:
            logger.info(f"Starting vulnerability scan for {ip}")
            self.shared_data.bjorn_orch_status = "NmapVulnScanner"
            self.shared_data.bjorn_progress = "0%"

            if self.shared_data.orchestrator_should_exit:
                return 'failed'

            # 1) Metadata
            meta = {}
            try:
                meta = json.loads(row.get('metadata') or '{}')
            except Exception:
                pass

            # 2) Récupérer MAC et TOUS les ports
            mac = row.get("MAC Address") or row.get("mac_address") or ""

            ports_str = ""
            if mac:
                r = self.shared_data.db.query(
                    "SELECT ports FROM hosts WHERE mac_address=? LIMIT 1", (mac,)
                )
                if r and r[0].get('ports'):
                    ports_str = r[0]['ports']

            if not ports_str:
                ports_str = (
                    row.get("Ports") or row.get("ports") or
                    meta.get("ports_snapshot") or ""
                )

            if not ports_str:
                logger.warning(f"No ports to scan for {ip}")
                self.shared_data.bjorn_progress = ""
                return 'failed'

            ports = [p.strip() for p in ports_str.split(';') if p.strip()]

            # Nettoyage des ports (garder juste le numéro si format 80/tcp)
            ports = [p.split('/')[0] for p in ports]

            self.shared_data.comment_params = {"ip": ip, "ports": str(len(ports))}
            logger.debug(f"Found {len(ports)} ports for {ip}: {ports[:5]}...")

            # 3) Filtrage "Rescan Only"
            if self.shared_data.config.get('vuln_rescan_on_change_only', False):
                if self._has_been_scanned(mac):
                    original_count = len(ports)
                    ports = self._filter_ports_already_scanned(mac, ports)
                    logger.debug(f"Filtered {original_count - len(ports)} already-scanned ports")

                    if not ports:
                        logger.info(f"No new/changed ports to scan for {ip}")
                        self.shared_data.bjorn_progress = "100%"
                        return 'success'

            # 4) SCAN AVEC PROGRESSION
            if self.shared_data.orchestrator_should_exit:
                return 'failed'

            logger.info(f"Starting nmap scan on {len(ports)} ports for {ip}")
            findings = self.scan_vulnerabilities(ip, ports)

            if self.shared_data.orchestrator_should_exit:
                logger.info("Scan interrupted by user")
                return 'failed'

            # 5) Déduplication en mémoire avant persistance
            findings = self._deduplicate_findings(findings)

            # 6) Persistance
            self.save_vulnerabilities(mac, ip, findings)

            # Finalisation UI
            self.shared_data.bjorn_progress = "100%"
            self.shared_data.comment_params = {"ip": ip, "vulns_found": str(len(findings))}
            logger.success(f"Vuln scan done on {ip}: {len(findings)} entries")
            return 'success'

        except Exception as e:
            logger.error(f"NmapVulnScanner failed for {ip}: {e}")
            self.shared_data.bjorn_progress = "Error"
            return 'failed'

    def _has_been_scanned(self, mac: str) -> bool:
        rows = self.shared_data.db.query("""
            SELECT 1 FROM action_queue
            WHERE mac_address=? AND action_name='NmapVulnScanner'
            AND status IN ('success', 'failed')
            LIMIT 1
        """, (mac,))
        return bool(rows)

    def _filter_ports_already_scanned(self, mac: str, ports: List[str]) -> List[str]:
        if not ports:
            return []

        rows = self.shared_data.db.query("""
            SELECT port, last_seen
            FROM detected_software
            WHERE mac_address=? AND is_active=1 AND port IS NOT NULL
        """, (mac,))

        seen = {}
        for r in rows:
            try:
                seen[str(r['port'])] = r.get('last_seen')
            except Exception:
                pass

        ttl = int(self.shared_data.config.get('vuln_rescan_ttl_seconds', 0) or 0)
        if ttl > 0:
            cutoff = datetime.utcnow() - timedelta(seconds=ttl)
            final_ports = []
            for p in ports:
                if p not in seen:
                    final_ports.append(p)
                else:
                    try:
                        dt = datetime.fromisoformat(seen[p].replace('Z', ''))
                        if dt < cutoff:
                            final_ports.append(p)
                    except Exception:
                        pass
            return final_ports
        else:
            return [p for p in ports if p not in seen]

    # ---------------------------- Helpers -------------------------------- #

    def _deduplicate_findings(self, findings: List[Dict]) -> List[Dict]:
        """Supprime les doublons (même port + vuln_id) pour éviter des inserts inutiles."""
        seen: set = set()
        deduped = []
        for f in findings:
            key = (str(f.get('port', '')), str(f.get('vuln_id', '')))
            if key not in seen:
                seen.add(key)
                deduped.append(f)
        return deduped

    def _extract_cpe_values(self, port_info: Dict[str, Any]) -> List[str]:
        cpe = port_info.get('cpe')
        if not cpe:
            return []
        if isinstance(cpe, str):
            return [x.strip() for x in cpe.splitlines() if x.strip()]
        if isinstance(cpe, (list, tuple, set)):
            return [str(x).strip() for x in cpe if str(x).strip()]
        return [str(cpe).strip()]

    def extract_cves(self, text: str) -> List[str]:
        """Extrait les CVE via regex pré-compilé (pas de recompilation à chaque appel)."""
        if not text:
            return []
        return CVE_RE.findall(str(text))

    # ---------------------------- Scanning (Batch Mode) ------------------------------ #

    def scan_vulnerabilities(self, ip: str, ports: List[str]) -> List[Dict]:
        """
        Orchestre le scan en lots (batches) pour permettre la mise à jour
        de la barre de progression.
        """
        all_findings = []

        fast        = bool(self.shared_data.config.get('vuln_fast', True))
        use_vulners = bool(self.shared_data.config.get('nse_vulners', False))
        max_ports   = int(self.shared_data.config.get('vuln_max_ports', 10 if fast else 20))

        # Pause entre batches – important sur Pi Zero pour laisser respirer le CPU
        batch_pause = float(self.shared_data.config.get('vuln_batch_pause', 0.5))

        # Taille de lot réduite par défaut (2 sur Pi Zero, configurable)
        batch_size  = int(self.shared_data.config.get('vuln_batch_size', 2))

        target_ports = ports[:max_ports]
        total = len(target_ports)
        if total == 0:
            return []

        batches = [target_ports[i:i + batch_size] for i in range(0, total, batch_size)]

        processed_count = 0

        for batch in batches:
            if self.shared_data.orchestrator_should_exit:
                break

            port_str = ','.join(batch)

            # Mise à jour UI avant le scan du lot
            pct = int((processed_count / total) * 100)
            self.shared_data.bjorn_progress = f"{pct}%"
            self.shared_data.comment_params = {
                "ip": ip,
                "progress": f"{processed_count}/{total} ports",
                "current_batch": port_str
            }

            t0 = time.time()

            # Scan du lot (instanciation locale pour éviter la corruption d'état)
            if fast:
                batch_findings = self._scan_fast_cpe_cve(ip, port_str, use_vulners)
            else:
                batch_findings = self._scan_heavy(ip, port_str)

            elapsed = time.time() - t0
            logger.debug(f"Batch [{port_str}] scanned in {elapsed:.1f}s – {len(batch_findings)} finding(s)")

            all_findings.extend(batch_findings)
            processed_count += len(batch)

            # Mise à jour post-lot
            pct = int((processed_count / total) * 100)
            self.shared_data.bjorn_progress = f"{pct}%"

            # Pause CPU entre batches (vital sur Pi Zero)
            if batch_pause > 0 and processed_count < total:
                time.sleep(batch_pause)

        return all_findings

    def _scan_fast_cpe_cve(self, ip: str, port_list: str, use_vulners: bool) -> List[Dict]:
        vulns: List[Dict] = []
        nm = nmap.PortScanner()  # Instance locale – pas de partage d'état

        # --version-light au lieu de --version-all : bien plus rapide sur Pi Zero
        # --min-rate/--max-rate : évite de saturer CPU et réseau
        args = (
            "-sV --version-light -T4 "
            "--max-retries 1 --host-timeout 60s --script-timeout 20s "
            "--min-rate 50 --max-rate 100"
        )
        if use_vulners:
            args += " --script vulners --script-args mincvss=0.0"

        logger.debug(f"[FAST] nmap {ip} -p {port_list}")
        try:
            nm.scan(hosts=ip, ports=port_list, arguments=args)
        except Exception as e:
            logger.error(f"Fast batch scan failed for {ip} [{port_list}]: {e}")
            return vulns

        if ip not in nm.all_hosts():
            return vulns

        host = nm[ip]
        for proto in host.all_protocols():
            for port in host[proto].keys():
                port_info = host[proto][port]
                service = port_info.get('name', '') or ''

                # CPE
                for cpe in self._extract_cpe_values(port_info):
                    vulns.append({
                        'port': port,
                        'service': service,
                        'vuln_id': f"CPE:{cpe}",
                        'script': 'service-detect',
                        'details': f"CPE: {cpe}"
                    })

                # CVE via vulners
                if use_vulners:
                    script_out = (port_info.get('script') or {}).get('vulners')
                    if script_out:
                        for cve in self.extract_cves(script_out):
                            vulns.append({
                                'port': port,
                                'service': service,
                                'vuln_id': cve,
                                'script': 'vulners',
                                'details': str(script_out)[:200]
                            })
        return vulns

    def _scan_heavy(self, ip: str, port_list: str) -> List[Dict]:
        vulnerabilities: List[Dict] = []
        nm = nmap.PortScanner()  # Instance locale

        vuln_scripts = [
            'vuln', 'exploit', 'http-vuln-*', 'smb-vuln-*',
            'ssl-*', 'ssh-*', 'ftp-vuln-*', 'mysql-vuln-*',
        ]
        script_arg = ','.join(vuln_scripts)
        # --min-rate/--max-rate pour ne pas saturer le Pi
        args = (
            f"-sV --script={script_arg} -T3 "
            "--script-timeout 30s --min-rate 50 --max-rate 100"
        )

        logger.debug(f"[HEAVY] nmap {ip} -p {port_list}")
        try:
            nm.scan(hosts=ip, ports=port_list, arguments=args)
        except Exception as e:
            logger.error(f"Heavy batch scan failed for {ip} [{port_list}]: {e}")
            return vulnerabilities

        if ip not in nm.all_hosts():
            return vulnerabilities

        host = nm[ip]
        discovered_ports_in_batch: set = set()

        for proto in host.all_protocols():
            for port in host[proto].keys():
                discovered_ports_in_batch.add(str(port))
                port_info = host[proto][port]
                service = port_info.get('name', '') or ''

                for script_name, output in (port_info.get('script') or {}).items():
                    for cve in self.extract_cves(str(output)):
                        vulnerabilities.append({
                            'port': port,
                            'service': service,
                            'vuln_id': cve,
                            'script': script_name,
                            'details': str(output)[:200]
                        })

        # CPE Scan optionnel (sur ce batch)
        if bool(self.shared_data.config.get('scan_cpe', False)):
            ports_for_cpe = list(discovered_ports_in_batch)
            if ports_for_cpe:
                vulnerabilities.extend(self.scan_cpe(ip, ports_for_cpe))

        return vulnerabilities

    def scan_cpe(self, ip: str, ports: List[str]) -> List[Dict]:
        cpe_vulns = []
        nm = nmap.PortScanner()  # Instance locale
        try:
            port_list = ','.join([str(p) for p in ports])
            # --version-light à la place de --version-all (bien plus rapide)
            args = "-sV --version-light -T4 --max-retries 1 --host-timeout 45s"
            nm.scan(hosts=ip, ports=port_list, arguments=args)

            if ip in nm.all_hosts():
                host = nm[ip]
                for proto in host.all_protocols():
                    for port in host[proto].keys():
                        port_info = host[proto][port]
                        service = port_info.get('name', '') or ''
                        for cpe in self._extract_cpe_values(port_info):
                            cpe_vulns.append({
                                'port': port,
                                'service': service,
                                'vuln_id': f"CPE:{cpe}",
                                'script': 'version-scan',
                                'details': f"CPE: {cpe}"
                            })
        except Exception as e:
            logger.error(f"scan_cpe failed for {ip}: {e}")
        return cpe_vulns

    # ---------------------------- Persistence ---------------------------- #

    def save_vulnerabilities(self, mac: str, ip: str, findings: List[Dict]):
        hostname = None
        try:
            host_row = self.shared_data.db.query_one(
                "SELECT hostnames FROM hosts WHERE mac_address=? LIMIT 1", (mac,)
            )
            if host_row and host_row.get('hostnames'):
                hostname = host_row['hostnames'].split(';')[0]
        except Exception:
            pass

        findings_by_port: Dict[int, Dict] = {}
        for f in findings:
            port = int(f.get('port', 0) or 0)
            if port not in findings_by_port:
                findings_by_port[port] = {'cves': set(), 'cpes': set()}

            vid = str(f.get('vuln_id', ''))
            vid_upper = vid.upper()
            if vid_upper.startswith('CVE-'):
                findings_by_port[port]['cves'].add(vid)
            elif vid_upper.startswith('CPE:'):
                # On stocke sans le préfixe "CPE:"
                findings_by_port[port]['cpes'].add(vid[4:])

        # 1) CVEs
        for port, data in findings_by_port.items():
            for cve in data['cves']:
                try:
                    self.shared_data.db.execute("""
                        INSERT INTO vulnerabilities(mac_address, ip, hostname, port, vuln_id, is_active, last_seen)
                        VALUES(?,?,?,?,?,1,CURRENT_TIMESTAMP)
                        ON CONFLICT(mac_address, vuln_id, port) DO UPDATE SET
                        is_active=1, last_seen=CURRENT_TIMESTAMP, ip=excluded.ip
                    """, (mac, ip, hostname, port, cve))
                except Exception as e:
                    logger.error(f"Save CVE err: {e}")

        # 2) CPEs
        for port, data in findings_by_port.items():
            for cpe in data['cpes']:
                try:
                    self.shared_data.db.add_detected_software(
                        mac_address=mac, cpe=cpe, ip=ip,
                        hostname=hostname, port=port
                    )
                except Exception as e:
                    logger.error(f"Save CPE err: {e}")

        logger.info(f"Saved vulnerabilities for {ip}: {len(findings)} findings")