import subprocess
pythonw = r'C:\Users\tianj\AppData\Local\Programs\Python\Python38\pythonw.exe'
script = r'C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system\tests\local-station-heartbeats.py'
process = subprocess.Popen([pythonw, script])
print(process.pid)
