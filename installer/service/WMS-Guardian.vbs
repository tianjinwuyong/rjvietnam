' ===================================================================
'  WMS Guardian launcher
'  ------------------------------------------------------------------
'  Deployed into the user's Startup folder. Runs silently via
'  wscript.exe after logon.
'
'  Responsibility: keep wms-guardian.cjs alive. If the guardian exits
'  or crashes, relaunch it 5 seconds later (second layer of defence).
'
'  This file is intentionally pure ASCII so that VBScript's ANSI
'  parser cannot corrupt any characters. The real paths are read from
'  %LOCALAPPDATA%\WMS\guardian.txt encoded as UTF-16LE.
' ===================================================================
Option Explicit

Dim sh, fso, cfgFile, ts, nodeExe, guardJs, cmd
Dim t0, elapsed, quickExit
quickExit = 0

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

cfgFile = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\WMS\guardian.txt"
If Not fso.FileExists(cfgFile) Then WScript.Quit 1

' Fourth argument -1 = read as Unicode (UTF-16LE)
Set ts = fso.OpenTextFile(cfgFile, 1, False, -1)
nodeExe = Trim(ts.ReadLine)
guardJs = Trim(ts.ReadLine)
ts.Close

If Not fso.FileExists(nodeExe) Then WScript.Quit 2
If Not fso.FileExists(guardJs) Then WScript.Quit 3

Do
    cmd = """" & nodeExe & """ """ & guardJs & """"
    t0 = Timer
    On Error Resume Next
    sh.Run cmd, 0, True
    If Err.Number <> 0 Then Err.Clear
    On Error GoTo 0
    elapsed = Timer - t0
    If elapsed < 0 Then elapsed = elapsed + 86400

    ' If the guardian keeps exiting immediately (for example because the
    ' Windows service mode has been enabled), give up after 3 attempts
    ' instead of looping forever.
    If elapsed < 5 Then
        quickExit = quickExit + 1
        If quickExit >= 3 Then WScript.Quit 0
    Else
        quickExit = 0
    End If

    WScript.Sleep 5000
Loop
