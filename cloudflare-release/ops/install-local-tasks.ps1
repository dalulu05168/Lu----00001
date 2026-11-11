param([string]$OpsHome='C:/Users/mrmal/Desktop/手机端/安全备份',[string]$Runner=(Join-Path $PSScriptRoot 'runner.cjs'))
$ErrorActionPreference='Stop'
$node=(Get-Command node.exe -ErrorAction Stop).Source
$runnerPath=(Resolve-Path -LiteralPath $Runner).Path
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$specs=@(
 @{Name='CN-Capital-Encrypted-Backup';Mode='scheduled-backup';Trigger=(New-ScheduledTaskTrigger -Daily -At '04:00')},
 @{Name='CN-Capital-Security-Monitor';Mode='monitor';Trigger=(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 15))}
)
$records=Join-Path $OpsHome 'records'
$result=@()
foreach($spec in $specs){
 $existing=Get-ScheduledTask -TaskName $spec.Name -ErrorAction SilentlyContinue
 if($existing){throw ('A task already exists: '+$spec.Name+'. Inspect before replacing it.')}
 $action=New-ScheduledTaskAction -Execute $node -Argument ('"'+$runnerPath+'" '+$spec.Mode) -WorkingDirectory (Split-Path -Parent $runnerPath)
 $task=New-ScheduledTask -Action $action -Trigger $spec.Trigger -Settings $settings -Principal $principal -Description 'CN Capital local encrypted backup/read-only security monitoring. No production business writes.'
 Register-ScheduledTask -TaskName $spec.Name -InputObject $task | Out-Null
 $saved=Get-ScheduledTask -TaskName $spec.Name
 if($saved.Actions.Execute -ne $node -or $saved.Actions.Arguments -ne $action.Arguments){throw 'Task action verification failed'}
 $result+=@{Name=$spec.Name;State=[string]$saved.State;Execute=$saved.Actions.Execute;Arguments=$saved.Actions.Arguments;LogonType=[string]$saved.Principal.LogonType;RunLevel=[string]$saved.Principal.RunLevel;Trigger=$saved.Triggers}
}
$report=@{RecordedAt=(Get-Date).ToUniversalTime().ToString('o');Timezone=(Get-TimeZone).Id;Tasks=$result;RequiresWindowsSignedIn=$true;MailConfigured=$false}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $records 'scheduled-tasks.json') -Encoding UTF8
$result | Select-Object Name,State,LogonType,RunLevel | ConvertTo-Json
