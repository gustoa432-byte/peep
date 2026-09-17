# One-time: enable key auth so the agent can deploy without password prompts.
# Run in your Cursor/PowerShell terminal, enter the root password when asked.

$ErrorActionPreference = "Stop"
$hostName = "157.228.191.73"
$user = "root"
$sshDir = Join-Path $env:USERPROFILE ".ssh"
$key = Join-Path $sshDir "id_ed25519"
$pub = "$key.pub"

if (-not (Test-Path $sshDir)) {
  New-Item -ItemType Directory -Path $sshDir | Out-Null
}

if (-not (Test-Path $key)) {
  ssh-keygen -t ed25519 -f $key -N '""' -C "cursor-peep-deploy"
  Write-Host "Created $key"
}

$pubKey = (Get-Content $pub -Raw).Trim()
Write-Host "Installing public key on ${user}@${hostName} (enter password)..."

$remote = @"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
grep -qxF '$pubKey' ~/.ssh/authorized_keys 2>/dev/null || echo '$pubKey' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo KEY_INSTALLED
"@

ssh -o StrictHostKeyChecking=accept-new "${user}@${hostName}" $remote

Write-Host "Testing key login..."
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i $key "${user}@${hostName}" "echo SSH_KEY_OK && hostname"

Write-Host "Done. Tell the agent to continue the deploy."
