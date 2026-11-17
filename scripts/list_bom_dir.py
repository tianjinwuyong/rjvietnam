# -*- coding: utf-8 -*-
import os
import glob

bom_dir = r"C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\dc\bom"
files = sorted(glob.glob(os.path.join(bom_dir, "*.xls")))
for f in files:
    print(repr(f))
