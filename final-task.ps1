$Nic1Index = 3
$Nic1IP = (Get-NetIPAddress -InterfaceIndex $Nic1Index -AddressFamily IPv4).IPAddress
Write-Host "nic1 IP is $Nic1IP"

# Use netsh to portproxy or Windows Firewall to strictly limit RDP to nic1's subnet/IP
# Disable RDP on all profiles first
Disable-NetFirewallRule -DisplayGroup "Remote Desktop"
# Create a specific rule allowing RDP only on nic1's IP
New-NetFirewallRule -DisplayName "RDP on NIC1 Only" -Direction Inbound -LocalPort 3389 -Protocol TCP -Action Allow -LocalAddress $Nic1IP

# Bind RDP via WMI if possible
# The safe way to bind RDP to a specific IP address in registry is not straightforward. 
# But restricting the firewall strictly to $Nic1IP achieves the exact same security/routing goal:
# Traffic coming from Mysterium (which gets routed to nic0) will be dropped for RDP.

# Install Mysterium
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$html = Invoke-WebRequest -Uri "https://mysteriumdark.com/" -UseBasicParsing
# Actually we can just download the latest release directly from github
$repo = "mysteriumnetwork/mysterium-vpn-desktop"
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -match "MysteriumDark-Windows-.*\.exe$" }
if ($asset) {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile C:\MysteriumDark.exe
    Start-Process -FilePath C:\MysteriumDark.exe -ArgumentList "/S" -Wait
}
