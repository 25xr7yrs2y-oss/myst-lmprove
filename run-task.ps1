$adapters = Get-NetAdapter
$adapters | Format-Table -AutoSize | Out-File C:\adapters.txt
$adapters | ConvertTo-Json | Out-File C:\adapters.json

# Attempt to configure RDP to nic1 (assuming nic1 is the second adapter)
if ($adapters.Count -gt 1) {
    # It's tricky to map InterfaceIndex to LanaID. We'll use registry if possible or just log it.
}

# Download Mysterium Dark
$dlUrl = "https://github.com/mysteriumnetwork/mysterium-vpn-desktop/releases/download/10.15.5/MysteriumDark-Windows-10.15.5.exe" # approximate
Invoke-WebRequest -Uri $dlUrl -OutFile C:\MysteriumDark.exe
# Start-Process -FilePath C:\MysteriumDark.exe -ArgumentList "/S" -Wait
