# Netbox Ops Center - Installation Walkthrough

## Prerequisites
- A Linux/Unix machine (Debian/Ubuntu recommended).
- Root access (sudo).
- Internet connection.

## Installation Steps

### Option 1: Local Installation
1.  **Navigate to the project directory**:
    ```bash
    cd /path/to/11-Netbox_ops_center
    ```
2.  **Run the installer**:
    ```bash
    sudo ./install.sh
    ```

### Option 2: Remote Deployment
To deploy to a remote server (e.g., 10.211.55.37):

1.  **Run the deployment script**:
    ```bash
    ./deploy_remote.sh [TARGET_IP] [USER] [PASSWORD]
    ```
    *Defaults: 10.211.55.37 / suporte / suportekggg*

    Example:
    ```bash
    ./deploy_remote.sh
    ```

2.  **Follow the prompts**:
    - The script will transfer files to the remote server.
    - It will SSH into the server and run `install.sh`.
    - You may be asked for the `sudo` password on the remote server if not provided or if `sshpass` is not used for sudo.

## Verification

After the installation completes, verify the services are running:

1.  **Check Containers**:
    ```bash
    docker compose ps
    ```
    You should see 4 containers: `proxy`, `app`, `portainer`, and `oxidized`.

2.  **Access Services**:
    - **Main App**: Open `http://<SERVER_IP>/`
    - **Portainer**: Open `http://<SERVER_IP>/portainer/`
    - **Oxidized**: Open `http://<SERVER_IP>/oxidized/`

## Troubleshooting

- **Logs**: Check `install_log.txt` for installation details.
- **Container Logs**:
    ```bash
    docker compose logs -f
    ```
- **Port Conflicts**: Ensure ports 80, 8080, 9443, and 8888 are not in use by other services.
