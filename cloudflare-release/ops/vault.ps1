param([ValidateSet('protect','unprotect')][string]$Mode,[Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$entropy=[Text.Encoding]::UTF8.GetBytes('CN-Capital-local-operations-v1')
if($Mode -eq 'protect'){
 if(Test-Path -LiteralPath $Path){throw 'Refusing to overwrite an existing credential vault'}
 $plain=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())
 try{$protected=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser);[IO.File]::WriteAllBytes($Path,$protected)}finally{[Array]::Clear($plain,0,$plain.Length)}
}else{
 $plain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($Path),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 try{[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))}finally{[Array]::Clear($plain,0,$plain.Length)}
}
