import asyncio
import logging
import sys
import os

# Adjust path to allow imports
# We are in backend/debug_jumpserver.py. We want to add the project root (one level up) to sys.path.
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
sys.path.insert(0, project_root)

# Configure logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

from backend.services.jumpserver_service import jumpserver_svc

async def main():
    target_path = "/DEFAULT/PRODUÇÃO/Teste_123"
    logger.info(f"Starting debug test for path: {target_path}")
    
    # 1. List existing nodes to see what we have
    logger.info("Fetching existing nodes...")
    nodes = await jumpserver_svc.get_nodes()
    logger.info(f"Found {len(nodes)} total nodes.")
    
    # Dump simple map of paths
    paths = sorted([n.get('full_value') for n in nodes if n.get('full_value')])
    logger.info("Existing paths (top 20):")
    for p in paths[:20]:
        logger.info(f" - {p}")
        
    # Check specifically for DEFAULT and PRODUÇÃO
    defaults = [n for n in nodes if 'default' in (n.get('full_value') or '').lower()]
    logger.info(f"Nodes matching 'default': {len(defaults)}")
    for d in defaults:
        logger.info(f" -> {d.get('full_value')} (ID: {d.get('id')}, KEY: {d.get('key')})")

    producoes = [n for n in nodes if 'produ' in (n.get('full_value') or '').lower()]
    logger.info(f"Nodes matching 'produ': {len(producoes)}")
    for p in producoes:
        logger.info(f" -> {p.get('full_value')} (ID: {p.get('id')}, KEY: {p.get('key')})")

    # 1.5 Clean up existing Teste_123 if exists
    logger.info("Cleaning up any existing 'Teste_123' node...")
    zombies = [n for n in nodes if n.get('value') == 'Teste_123']
    for z in zombies:
        zid = z.get('id')
        logger.info(f"Deleting zombie node {z.get('full_value')} ({zid})...")
        # Raw delete since service doesn't have delete_node
        headers = await jumpserver_svc.get_headers()
        import httpx
        async with httpx.AsyncClient(verify=False) as client:
             resp = await client.delete(f"{jumpserver_svc.base_url}/api/v1/assets/nodes/{zid}/", headers=headers)
             logger.info(f"Delete status: {resp.status_code}")

    # 2. Experimental Creation Tests
    logger.info("\n=== Starting Experimental Creation Tests ===")
    parent_id = "c34ec13e-dd45-48f5-a73f-74467807ef98"
    parent_key = "1:342"
    
    # Helper to clean
    async def clean_node(name):
        zs = [n for n in nodes if n.get('value') == name]
        headers_del = await jumpserver_svc.get_headers()
        async with httpx.AsyncClient(verify=False) as client:
            # Refresh nodes list to find it if just created? simpler to just try delete by ID if we captured it, 
            # but for now assume we start clean or clean up via a fresh fetch if needed. 
            # Actually, let's just use the 'zombies' logic from before but updated for the specific name.
            # For simplicity in this script, just fetching specific node by name would be better?
            # Let's just delete by ID if we know it from creation response.
            pass

    import httpx
    headers = await jumpserver_svc.get_headers()
    base_url = jumpserver_svc.base_url
    
    async def try_create(test_name, payload):
        logger.info(f"\n--- Testing Payload: {test_name} ---")
        logger.info(f"Payload: {payload}")
        async with httpx.AsyncClient(verify=False) as client:
             # 1. Ensure clean slate
             # Fetch all nodes again to find zombies? Expensive. 
             # Let's just rely on unique names for the test: Teste_A, Teste_B
             
             resp = await client.post(f"{base_url}/api/v1/assets/nodes/", headers=headers, json=payload)
             logger.info(f"Status: {resp.status_code}")
             if resp.status_code == 201:
                 data = resp.json()
                 logger.info(f"Result Full Value: {data.get('full_value')}")
                 logger.info(f"Result Key: {data.get('key')}")
                 new_id = data.get('id')
                 # Clean up immediately
                 if new_id:
                     logger.info(f"Cleaning up {new_id}...")
                     await client.delete(f"{base_url}/api/v1/assets/nodes/{new_id}/", headers=headers)
                 
                 if "/PRODUÇÃO/" in data.get('full_value', ''):
                     logger.info(">>> SUCCESS! usage matches hierarchy.")
                 else:
                     logger.error(">>> FAILED. Landed in wrong path.")
             else:
                 logger.error(f"Creation failed: {resp.text}")

    # Test A: Parent = ID
    await try_create("Parent as ID", {"value": "Teste_ParentID", "parent": parent_id})

    # Test B: Parent = Key
    await try_create("Parent as Key", {"value": "Teste_ParentKey", "parent": parent_key})

    # Test C: Parent + Org
    await try_create("Parent ID + Org", {"value": "Teste_ParentID_Org", "parent": parent_id, "org_id": "00000000-0000-0000-0000-000000000002"})

    # Test D: Explicit parent_id field
    await try_create("Explicit parent_id field", {"value": "Teste_ExplicitField", "parent_id": parent_id})
    
    logger.info("=== Experiments Complete ===")
    return # Exit early to avoid running the old logic


if __name__ == "__main__":
    asyncio.run(main())
