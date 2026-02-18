#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
freya_harvest.py -- Data collection and intelligence aggregation for BJORN.
Monitors output directories and generates consolidated reports.
"""

import os
import json
import glob
import threading
import time
from datetime import datetime

from collections import defaultdict
from typing import Any, Dict, List, Optional

from logger import Logger

logger = Logger(name="freya_harvest.py")

# -------------------- Action metadata --------------------
b_class       = "FreyaHarvest"
b_module      = "freya_harvest"
b_status      = "freya_harvest"
b_port        = None
b_service     = "[]"
b_trigger     = "on_start"
b_parent      = None
b_action      = "normal"
b_priority    = 50
b_cooldown    = 0
b_rate_limit  = None
b_timeout     = 1800
b_max_retries = 1
b_stealth_level = 10  # Local file processing is stealthy
b_risk_level  = "low"
b_enabled     = 1
b_tags        = ["harvest", "report", "aggregator", "intel"]
b_category    = "recon"
b_name        = "Freya Harvest"
b_description = "Aggregates findings from all modules into consolidated intelligence reports."
b_author      = "Bjorn Team"
b_version     = "2.0.4"
b_icon        = "FreyaHarvest.png"

b_args = {
    "input_dir": {
        "type": "text", 
        "label": "Input Data Dir", 
        "default": "/home/bjorn/Bjorn/data/output"
    },
    "output_dir": {
        "type": "text", 
        "label": "Reports Dir", 
        "default": "/home/bjorn/Bjorn/data/reports"
    },
    "watch": {
        "type": "checkbox", 
        "label": "Continuous Watch", 
        "default": True
    },
    "format": {
        "type": "select", 
        "label": "Report Format", 
        "choices": ["json", "md", "all"], 
        "default": "all"
    }
}

class FreyaHarvest:
    def __init__(self, shared_data):
        self.shared_data = shared_data
        self.data = defaultdict(list)
        self.lock = threading.Lock()
        self.last_scan_time = 0

    def _collect_data(self, input_dir):
        """Scan directories for JSON findings."""
        categories = ['wifi', 'topology', 'webscan', 'packets', 'hashes']
        new_findings = 0
        
        for cat in categories:
            cat_path = os.path.join(input_dir, cat)
            if not os.path.exists(cat_path): continue
            
            for f_path in glob.glob(os.path.join(cat_path, "*.json")):
                if os.path.getmtime(f_path) > self.last_scan_time:
                    try:
                        with open(f_path, 'r', encoding='utf-8') as f:
                            finds = json.load(f)
                            with self.lock:
                                self.data[cat].append(finds)
                            new_findings += 1
                    except: pass
        
        if new_findings > 0:
            logger.info(f"FreyaHarvest: Collected {new_findings} new intelligence items.")
            self.shared_data.log_milestone(b_class, "DataHarvested", f"Found {new_findings} new items")
        
        self.last_scan_time = time.time()

    def _generate_report(self, output_dir, fmt):
        """Generate consolidated findings report."""
        if not any(self.data.values()): 
            return
            
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        os.makedirs(output_dir, exist_ok=True)
        
        if fmt in ['json', 'all']:
            out_file = os.path.join(output_dir, f"intel_report_{ts}.json")
            with open(out_file, 'w') as f:
                json.dump(dict(self.data), f, indent=4)
            self.shared_data.log_milestone(b_class, "ReportGenerated", f"JSON: {os.path.basename(out_file)}")

        if fmt in ['md', 'all']:
            out_file = os.path.join(output_dir, f"intel_report_{ts}.md")
            with open(out_file, 'w') as f:
                f.write(f"# Bjorn Intelligence Report - {ts}\n\n")
                for cat, items in self.data.items():
                    f.write(f"## {cat.capitalize()}\n- Items: {len(items)}\n\n")
            self.shared_data.log_milestone(b_class, "ReportGenerated", f"MD: {os.path.basename(out_file)}")

    def execute(self, ip, port, row, status_key) -> str:
        input_dir = getattr(self.shared_data, "freya_harvest_input", b_args["input_dir"]["default"])
        output_dir = getattr(self.shared_data, "freya_harvest_output", b_args["output_dir"]["default"])
        watch = getattr(self.shared_data, "freya_harvest_watch", True)
        fmt = getattr(self.shared_data, "freya_harvest_format", "all")
        timeout = int(getattr(self.shared_data, "freya_harvest_timeout", 600))

        logger.info(f"FreyaHarvest: Starting data harvest from {input_dir}")
        self.shared_data.log_milestone(b_class, "Startup", "Monitoring intelligence directories")

        start_time = time.time()
        try:
            while time.time() - start_time < timeout:
                if self.shared_data.orchestrator_should_exit:
                    break
                
                self._collect_data(input_dir)
                self._generate_report(output_dir, fmt)
                
                # Progress
                elapsed = int(time.time() - start_time)
                prog = int((elapsed / timeout) * 100)
                self.shared_data.bjorn_progress = f"{prog}%"
                
                if not watch:
                    break
                
                time.sleep(30) # Scan every 30s

            self.shared_data.log_milestone(b_class, "Complete", "Harvesting session finished.")

        except Exception as e:
            logger.error(f"FreyaHarvest error: {e}")
            return "failed"
            
        return "success"

if __name__ == "__main__":
    from init_shared import shared_data
    harvester = FreyaHarvest(shared_data)
    harvester.execute("0.0.0.0", None, {}, "freya_harvest")