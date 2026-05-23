#!/bin/bash -ev

useradd -m -d /home/myst -s /bin/bash myst
usermod --password "$(openssl passwd -6 mystberry)" myst

rm -f /etc/sudoers.d/010_pi-nopasswd
install -m 644 myst_sudo_nopasswd /etc/sudoers.d/010_myst-nopasswd
