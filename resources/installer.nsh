!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli\manage-path.ps1" -Action add -CliDirectory "$INSTDIR\resources\cli"'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli\manage-path.ps1" -Action remove -CliDirectory "$INSTDIR\resources\cli"'
  Pop $0
!macroend
