# NetBox Ops Center

Uma plataforma completa de gestão de rede, integrando NetBox, monitoramento SNMP, backups com Oxidized e gestão de containers com Portainer.

## 🚀 Guia de Instalação Completo

Siga estes passos para baixar, instalar e testar a aplicação.

### Pré-requisitos
- Um servidor Linux (Ubuntu/Debian recomendado)
- Acesso à internet
- Usuário com permissão `sudo` (root)
- Git instalado (`sudo apt install git` se não tiver)

### Passo 1: Download do Projeto
Baixe o código fonte do repositório para o seu servidor:

```bash
# 1. Clone o repositório
git clone https://github.com/keslleykledston/11-Netbox_ops_center.git

# 2. Entre na pasta do projeto
cd 11-Netbox_ops_center
```

### Passo 2: Instalação

#### Opção A: Instalação Local (Nesta máquina)
Se você já está no servidor onde o sistema vai rodar:

1.  **Execute o instalador**:
    ```bash
    sudo ./install.sh
    ```
2.  **Siga as instruções na tela**. O script:
    - instala Docker e Docker Compose (se necessário);
    - configura os arquivos `.env`;
    - roda `npm install` no frontend e `npm --prefix server install && npm --prefix server run prisma:generate` automaticamente;
    - sobe toda a stack com `docker compose up -d`.

#### Opção B: Instalação Remota (De outro computador)
Se você quer instalar em um servidor remoto a partir do seu computador atual:

1.  **Execute o script de deploy**:
    ```bash
    # Sintaxe: ./deploy_remote.sh [IP_DO_SERVIDOR] [USUARIO] [SENHA]
    ./deploy_remote.sh 10.211.55.37 suporte suportekggg
    ```

### Passo 3: Validação e Testes

Após a instalação, verifique se tudo está funcionando:

1.  **Verifique os Containers**:
    No servidor, execute:
    ```bash
    docker compose ps
    ```
    Você deve ver 4 serviços com status "Up": `proxy`, `app`, `portainer`, `oxidized`.

2.  **Acesse pelo Navegador**:
    Abra os seguintes endereços (troque `localhost` pelo IP do servidor se necessário):

    | Serviço | Endereço | O que verificar |
    | :--- | :--- | :--- |
    | **Painel Principal** | `http://localhost/` | A tela de login deve aparecer. |
    | **Portainer** | `http://localhost/portainer/` | Deve pedir para criar senha de admin. |
    | **Oxidized** | `http://localhost/oxidized/` | Deve mostrar a interface do Oxidized. |

---

## 🔄 Manutenção e Atualizações

Para atualizar o sistema em produção para a versão mais recente do código:

1.  **Acesse o servidor** via SSH.
2.  **Navegue até a pasta do projeto**:
    ```bash
    cd 11-Netbox_ops_center
    ```
3.  **Execute o script de atualização**:
    ```bash
    ./update.sh
    ```

O script irá automaticamente:
- Verificar se há novas versões no GitHub.
- Baixar o código atualizado (`git pull`).
- Atualizar as imagens Docker (`docker compose pull`).
- Reconstruir e reiniciar os containers necessários (`docker compose up -d --build`).

---

## 🛠️ Solução de Problemas

- **Comando git não encontrado?**
    - Instale o git: `sudo apt update && sudo apt install git -y`

- **Nada funciona?**
    - Verifique os logs de instalação: `cat install_log.txt`
    - Verifique os logs dos containers: `docker compose logs -f`
- **Frontend responde 500 para todas as rotas `/api`?**
    - Certifique-se de que o backend está com as dependências instaladas:
      ```bash
      npm install
      npm --prefix server install
      npm --prefix server run prisma:generate
      ```
    - Reinicie os containers com `docker compose up -d --build`.

---

## ⚙️ Área Técnica (Desenvolvedores)

<details>
<summary>Clique para ver detalhes avançados</summary>

### Arquitetura
- **Frontend**: Vite + React (Porta interna 8080)
- **Backend**: Node.js + Express (Porta interna 4000)
- **Proxy**: Nginx (Porta externa 80) - Redireciona tráfego baseado na URL.
- **Banco de Dados**: SQLite (arquivo `dev.db`).

### Comandos Úteis
- **Parar tudo**: `docker compose down`
- **Reiniciar**: `docker compose restart`
- **Ver logs**: `docker compose logs -f`

</details>
