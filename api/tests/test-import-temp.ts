import { importShipdtShips, getAllAisEntities } from '../src/data/aisDataStore.js';
import { registerCache, queryViewport } from '../src/data/shipdtGridManager.js';
import { getCache, setCache } from '../src/data/shipdtCache.js';

registerCache(getCache, setCache);

async function main() {
  console.log('=== 导入前统计 ===');
  const before = getAllAisEntities();
  console.log('总船舶数:', before.length);
  
  const result = await queryViewport(122.4, 122.7, 31.7, 31.9);
  console.log('\n=== 导入 ShipDT 数据 ===');
  const { added, skipped } = importShipdtShips(result.ships);
  console.log('新增:', added, '| 跳过:', skipped);
  
  const after = getAllAisEntities();
  console.log('\n=== 导入后统计 ===');
  console.log('总船舶数:', after.length);
  
  after.slice(0, 5).forEach((e) => {
    console.log('  ' + e.id + ': ' + e.name + ' | ' + e.description);
  });
}

main().catch(console.error);
