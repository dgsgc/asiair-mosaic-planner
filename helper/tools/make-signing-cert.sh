#!/bin/zsh
# Makes a free, self-made code-signing certificate for building the apps on
# this Mac, kept in its own keychain in ~/.asiair-signing (not your login
# keychain). build.sh then signs with it, so macOS keeps permissions such as
# Accessibility when you install a new build. Other Macs still see the apps as
# from an unidentified developer; only Apple's developer program changes that.
set -eu
D="$HOME/.asiair-signing"
CN="ASIAIR Mosaic Planner local signing"
KC="$D/signing.keychain-db"
mkdir -p "$D"; chmod 700 "$D"; cd "$D"
if [[ -f "$KC" ]]; then echo "Already set up in $D."; exit 0; fi
openssl rand -hex 24 > password; chmod 600 password
PW=$(cat password)
cat > cert.cnf <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $CN
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3650 -config cert.cnf 2>/dev/null
openssl pkcs12 -export -inkey key.pem -in cert.pem -out signing.p12 -passout "pass:$PW" -name "$CN" 2>/dev/null
rm -f key.pem; chmod 600 signing.p12
security create-keychain -p "$PW" "$KC"
security set-keychain-settings "$KC"
security unlock-keychain -p "$PW" "$KC"
security import signing.p12 -k "$KC" -P "$PW" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KC" >/dev/null
# codesign only finds identities in keychains on the search list.
security list-keychains -d user -s $(security list-keychains -d user | tr -d '"') "$KC"
echo "Made \"$CN\" in $KC."
