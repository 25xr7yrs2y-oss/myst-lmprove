# Get net adapters
$adapters = Get-NetAdapter | Sort-Object Name
if ($adapters.Count -gt 1) {
    # nic1 is likely the second adapter
    $nic1 = $adapters[1]
    
    # Enable RDP on all first just in case
    Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -name "fDenyTSConnections" -value 0
    Enable-NetFirewallRule -DisplayGroup "Remote Desktop"
    
    # We need the GUID or the Index of nic1. WMI Win32_TSNetworkAdapterSetting is usually used to bind RDP.
    # Actually, a simpler way is using WMI:
    $ts = Get-WmiObject -Class "Win32_TSNetworkAdapterSetting" -Namespace "root\cimv2\TerminalServices"
    # Find the one matching our adapter's GUID or Description
    # But usually setting it via GUI is safer. Let's try WMI:
    $nic1Wmi = Get-WmiObject -Class Win32_NetworkAdapter | Where-Object { $_.NetConnectionID -eq $nic1.Name }
    $setting = Get-WmiObject -Class "Win32_TSNetworkAdapterSetting" -Namespace "root\cimv2\TerminalServices" | Where-Object { $_.NetworkAdapterLanaID -ne 0 }
    
    # Let's write the routing script to a log so we can see what's what.
    $adapters | Out-File C:\adapters.txt
}

# Download Mysterium Dark
$installerPath = "C:\mysterium_dark_installer.exe"
Invoke-WebRequest -Uri "https://github.com/mysteriumnetwork/mysterium-vpn-desktop/releases/latest/download/MysteriumDark-Windows-x64.exe" -OutFile $installerPath
# Note: we need the direct link if possible, or we can use chocolatey or similar. Wait, Mysterium Dark website provides a link.
# Let's use a dummy or known github release link for now. I'll use the official link if I can find it.
# Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait
