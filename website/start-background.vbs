' Solo Trading Charts - start the local server hidden (no console window).
' Used by the optional Windows logon task; double-clicking also works.
Option Explicit
Dim fso, shell, here, nodeExe, serverJs
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = fso.BuildPath(fso.GetParentFolderName(here), "tradingview\runtime\node.exe")
serverJs = fso.BuildPath(here, "server.mjs")
If Not fso.FileExists(nodeExe) Then
  nodeExe = "node.exe"
End If
shell.CurrentDirectory = here
shell.Run """" & nodeExe & """ """ & serverJs & """", 0, False
