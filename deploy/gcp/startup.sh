#!/usr/bin/env bash
set -Eeuo pipefail
exec > >(tee -a /var/log/rallyroo-bootstrap.log | logger -t rallyroo-bootstrap) 2>&1

METADATA_URL=http://metadata.google.internal/computeMetadata/v1/instance/attributes
metadata() {
  curl --fail --silent --show-error \
    -H 'Metadata-Flavor: Google' "$METADATA_URL/$1"
}

K3S_VERSION=$(metadata rallyroo-k3s-version)
K3S_CLUSTER_CIDR=$(metadata rallyroo-k3s-cluster-cidr)
K3S_SERVICE_CIDR=$(metadata rallyroo-k3s-service-cidr)
K3S_CLUSTER_DNS=$(metadata rallyroo-k3s-cluster-dns)
HELM_VERSION=$(metadata rallyroo-helm-version)
FLUX_VERSION=$(metadata rallyroo-flux-version)
CLOUDFLARED_VERSION=$(metadata rallyroo-cloudflared-version)
CLOUDFLARED_SHA256=$(metadata rallyroo-cloudflared-sha256)
INSTALL_OPS_AGENT=$(metadata rallyroo-install-ops-agent)
BACKUP_BUCKET=$(metadata rallyroo-backup-bucket)

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git jq gnupg iptables openssl unattended-upgrades

install -d -m 0755 /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/cloud.google.gpg ]]; then
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg
fi
cat >/etc/apt/sources.list.d/google-cloud-sdk.list <<'EOF'
deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main
EOF
apt-get update
apt-get install -y --no-install-recommends google-cloud-cli

if [[ "$INSTALL_OPS_AGENT" == "true" ]] && ! dpkg-query -W google-cloud-ops-agent >/dev/null 2>&1; then
  tmp_agent=$(mktemp)
  curl -fsSL -o "$tmp_agent" https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  bash "$tmp_agent" --also-install
  rm -f "$tmp_agent"
fi

DATA_DEVICE=/dev/disk/by-id/google-rallyroo-data
for _ in $(seq 1 60); do
  [[ -b "$DATA_DEVICE" ]] && break
  sleep 2
done
[[ -b "$DATA_DEVICE" ]] || { echo "Data disk did not appear" >&2; exit 1; }
if ! blkid "$DATA_DEVICE" >/dev/null 2>&1; then
  mkfs.ext4 -m 0 -L rallyroo-data "$DATA_DEVICE"
fi
DATA_UUID=$(blkid -s UUID -o value "$DATA_DEVICE")
grep -q "UUID=$DATA_UUID " /etc/fstab || \
  printf 'UUID=%s /var/local/rallyroo ext4 defaults,noatime,nofail 0 2\n' "$DATA_UUID" >>/etc/fstab
install -d -m 0755 /var/local/rallyroo
mountpoint -q /var/local/rallyroo || mount /var/local/rallyroo
# The PostgreSQL Alpine image runs as UID/GID 70 after its root entrypoint.
# Assign the host path explicitly because hostPath volumes do not correct it.
install -d -o 70 -g 70 -m 0700 /var/local/rallyroo/postgres
install -d -m 0770 /var/local/rallyroo/redis
install -d -m 0700 /etc/rallyroo
printf 'RALLYROO_BACKUP_BUCKET=%q\n' "$BACKUP_BUCKET" >/etc/rallyroo/environment
chmod 0600 /etc/rallyroo/environment

install_k3s() {
  local tmp checksum
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/k3s" \
    "https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION}/k3s"
  curl -fsSL -o "$tmp/checksums" \
    "https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION}/sha256sum-amd64.txt"
  checksum=$(awk '$2 == "k3s" || $2 == "./k3s" { print $1; exit }' "$tmp/checksums")
  [[ -n "$checksum" ]] || { echo "Could not find k3s checksum" >&2; exit 1; }
  echo "$checksum  $tmp/k3s" | sha256sum --check --status
  install -m 0755 "$tmp/k3s" /usr/local/bin/k3s
  ln -sf k3s /usr/local/bin/kubectl
  ln -sf k3s /usr/local/bin/crictl
  ln -sf k3s /usr/local/bin/ctr
  rm -rf "$tmp"
}

if ! /usr/local/bin/k3s --version 2>/dev/null | head -1 | grep -Fq "$K3S_VERSION"; then
  install_k3s
fi
cat >/etc/systemd/system/k3s.service <<EOF
[Unit]
Description=Lightweight Kubernetes
Documentation=https://docs.k3s.io
Wants=network-online.target
After=network-online.target

[Service]
Type=notify
EnvironmentFile=-/etc/default/k3s
KillMode=process
Delegate=yes
LimitNOFILE=1048576
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
TimeoutStartSec=0
Restart=always
RestartSec=5s
ExecStart=/usr/local/bin/k3s server --disable=traefik --disable=servicelb --write-kubeconfig-mode=0600 --secrets-encryption --cluster-cidr=$K3S_CLUSTER_CIDR --service-cidr=$K3S_SERVICE_CIDR --cluster-dns=$K3S_CLUSTER_DNS

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable k3s
# Restart deliberately so a metadata-driven k3s or unit update takes effect.
systemctl restart k3s

install_helm() {
  local tmp archive
  tmp=$(mktemp -d)
  archive="helm-v${HELM_VERSION}-linux-amd64.tar.gz"
  curl -fsSL -o "$tmp/$archive" "https://get.helm.sh/$archive"
  curl -fsSL -o "$tmp/$archive.sha256sum" "https://get.helm.sh/$archive.sha256sum"
  (cd "$tmp" && sha256sum --check "$archive.sha256sum")
  tar -xzf "$tmp/$archive" -C "$tmp"
  install -m 0755 "$tmp/linux-amd64/helm" /usr/local/bin/helm
  rm -rf "$tmp"
}
if ! helm version --short 2>/dev/null | grep -Fq "v${HELM_VERSION}"; then
  install_helm
fi

install_flux() {
  local tmp archive
  tmp=$(mktemp -d)
  archive="flux_${FLUX_VERSION}_linux_amd64.tar.gz"
  curl -fsSL -o "$tmp/$archive" \
    "https://github.com/fluxcd/flux2/releases/download/v${FLUX_VERSION}/$archive"
  curl -fsSL -o "$tmp/checksums" \
    "https://github.com/fluxcd/flux2/releases/download/v${FLUX_VERSION}/flux_${FLUX_VERSION}_checksums.txt"
  (cd "$tmp" && grep "  $archive$" checksums | sha256sum --check --status)
  tar -xzf "$tmp/$archive" -C "$tmp" flux
  install -m 0755 "$tmp/flux" /usr/local/bin/flux
  rm -rf "$tmp"
}
if ! flux version --client 2>/dev/null | grep -Fq "v${FLUX_VERSION}"; then
  install_flux
fi

install_cloudflared() {
  local tmp
  tmp=$(mktemp)
  curl -fsSL -o "$tmp" \
    "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64"
  echo "$CLOUDFLARED_SHA256  $tmp" | sha256sum --check --status
  install -m 0755 "$tmp" /usr/local/bin/cloudflared
  rm -f "$tmp"
}
if ! cloudflared --version 2>/dev/null | grep -Fq "$CLOUDFLARED_VERSION"; then
  install_cloudflared
fi

if ! id cloudflared >/dev/null 2>&1; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin cloudflared
fi
chown root:cloudflared /etc/rallyroo
chmod 0750 /etc/rallyroo
cat >/etc/systemd/system/cloudflared-rallyroo.service <<'EOF'
[Unit]
Description=Rallyroo Cloudflare Tunnel
After=network-online.target k3s.service
Wants=network-online.target
ConditionPathExists=/etc/rallyroo/cloudflared.env

[Service]
Type=simple
User=cloudflared
Group=cloudflared
EnvironmentFile=/etc/rallyroo/cloudflared.env
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate run --token ${CLOUDFLARED_TOKEN}
Restart=always
RestartSec=5s
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
EOF
cat >/usr/local/sbin/rallyroo-set-cloudflare-token <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
read -r -s -p 'Cloudflare tunnel token: ' token
echo
[[ -n "$token" && "$token" != *$'\n'* ]] || { echo "Invalid empty token" >&2; exit 1; }
umask 077
printf 'CLOUDFLARED_TOKEN=%s\n' "$token" >/etc/rallyroo/cloudflared.env
chown root:cloudflared /etc/rallyroo/cloudflared.env
chmod 0640 /etc/rallyroo/cloudflared.env
unset token
systemctl daemon-reload
systemctl enable --now cloudflared-rallyroo.service
EOF
chmod 0755 /usr/local/sbin/rallyroo-set-cloudflare-token
cat >/usr/local/sbin/rallyroo-install-onepassword-operator <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl create namespace onepassword-system --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace rallyroo --dry-run=client -o yaml | kubectl apply -f -
read -r -s -p '1Password service account token: ' token
echo
[[ -n "$token" ]] || { echo "Token cannot be empty" >&2; exit 1; }
printf '%s' "$token" | kubectl -n onepassword-system create secret generic \
  onepassword-service-account-token --from-file=token=/dev/stdin \
  --dry-run=client -o yaml | kubectl apply -f -
unset token
helm repo add 1password https://1password.github.io/connect-helm-charts
helm repo update 1password
helm upgrade --install onepassword 1password/connect \
  --namespace onepassword-system --version 2.4.1 \
  --set connect.create=false \
  --set operator.create=true \
  --set operator.authMethod=service-account \
  --set 'operator.watchNamespace={rallyroo}' \
  --set operator.autoRestart=true \
  --wait --timeout 5m
EOF
chmod 0755 /usr/local/sbin/rallyroo-install-onepassword-operator
systemctl daemon-reload

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
for _ in $(seq 1 60); do
  kubectl get nodes >/dev/null 2>&1 && break
  sleep 2
done
kubectl get nodes >/dev/null
flux check --pre
flux install \
  --namespace flux-system \
  --components source-controller,helm-controller,notification-controller \
  --network-policy=true

touch /var/lib/rallyroo-bootstrap-complete
echo "Rallyroo host bootstrap completed"
