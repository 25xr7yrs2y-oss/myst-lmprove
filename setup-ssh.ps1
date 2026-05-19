# 1. Ensure SSH is installed and running
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction SilentlyContinue
Start-Service sshd -ErrorAction SilentlyContinue
Set-Service -Name sshd -StartupType 'Automatic'

# 2. Fix sshd_config to use standard authorized_keys for Administrators
$sshd_config = "C:\ProgramData\ssh\sshd_config"
if (Test-Path $sshd_config) {
    $content = Get-Content $sshd_config
    $content = $content -replace '(?m)^Match Group administrators', '#Match Group administrators'
    $content = $content -replace '(?m)^\s*AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys', '#AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys'
    $content = $content -replace '(?m)^#?PubkeyAuthentication.*', 'PubkeyAuthentication yes'
    $content | Set-Content $sshd_config
}

# 3. Add my SSH public key to the xiaogong user
$userDir = "C:\Users\xiaogong"
$sshDir = "$userDir\.ssh"
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir -Force
}

$pubKey = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCuzSmF/Q83agzTiFFkvb4vurzFNEK0tOIHTNYQlKLPF/3Q6x2QH+TdNEQezZ8yiSrz7zUrLW69AiqUnM+N/qNoarg9VvtGqjEQjajHZyUvxRz6ZPKC3N6GY9t2W+wbwRuWmA16hggL5AlGQIrJurJkl142SptZlUmD1P2CBAVJoufoLYSAclkFSgI2EZa0FsABMqCcsHoO9TkFYjZFpm5vIlr/I9dpXjxGtTVEFW0XicV6JNXwv/Ckg1AHxrdIpwBDI2BTxOq9Opr01ew0Ewg7cEaQlQGNyTlZ6MXqNLKKHW9VOWyvEDJUhIUx3sy3NTk0qW07hfhQ+h2YUpWKn4lypl5bpKoI2FqnbCbqnB08D39949/K/ytaxjyHncK76oKp5iPGpBcABuHlr2LY4Kc8KjkwWRCO3VRrP/jcLJoyg0PY8V+6QywdzWQrpaJQhblgCBrWwO2Io2Pnc1gUfXP0HbwGlcaTG6MeqFyMc6XNvUyaiB4o9LJha+tuzL+ZiXk= xiaogong@xiaogongdeMac-mini.local"
$authKeys = "$sshDir\authorized_keys"
$pubKey | Out-File -FilePath $authKeys -Encoding ASCII -Append

# 4. Restart SSH service
Restart-Service sshd -Force
