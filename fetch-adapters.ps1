# Output to serial port or log
$adapters = Get-NetAdapter
$output = $adapters | Select-Object Name, InterfaceDescription, MacAddress, InterfaceIndex | ConvertTo-Json
Write-Host "ADAPTER_INFO_START"
Write-Host $output
Write-Host "ADAPTER_INFO_END"

# Also download mysterium again using TLS 1.2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dlUrl = "https://github.com/mysteriumnetwork/mysterium-vpn-desktop/releases/download/10.15.5/MysteriumDark-Windows-10.15.5.exe"
Invoke-WebRequest -Uri $dlUrl -OutFile C:\MysteriumDark.exe
