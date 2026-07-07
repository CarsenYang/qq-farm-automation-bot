/**
 * 游戏配置数据模块
 * 从 gameConfig 目录加载配置数据
 */

const fs = require('node:fs');
const path = require('node:path');
const { getResourcePath } = require('./runtime-paths');

// ============ 等级经验表 ============
let roleLevelConfig = null;
let levelExpTable = null;  // 累计经验表，索引为等级

// ============ 植物配置 ============
let plantConfig = null;
const plantMap = new Map();  // id -> plant
const seedToPlant = new Map();  // seed_id -> plant
const fruitToPlant = new Map();  // fruit_id -> plant (果实ID -> 植物)
let itemInfoConfig = null;
let mutantTypesConfig = null;
const mutantTypeMap = new Map();

/**
 * 获取变异类型配置
 */
function getMutantType(typeName) {
    return mutantTypeMap.get(typeName) || null;
}

/**
 * 根据品质获取变异类型列表
 */
function getMutantTypesByQuality(quality) {
    const result = [];
    for (const [name, cfg] of mutantTypeMap) {
        if (cfg.quality === quality) result.push({ name, ...cfg });
    }
    return result;
}

/**
 * 获取所有变异类型
 */
function getAllMutantTypes() {
    const result = {};
    for (const [name, cfg] of mutantTypeMap) {
        result[name] = cfg;
    }
    return result;
}

/**
 * 判断植物是否是黄金变异植物
 */
function isGoldenPlant(plantId) {
    const plant = plantMap.get(plantId);
    if (!plant) return false;
    if (String(plant.harvestAniName || "") === "anim_harvest_gold") return true;
    if (String(plant.name || "").startsWith("黄金·")) return true;
    return false;
}

/**
 * 判断是否是黄金变异果实
 */
function isGoldenFruit(fruitId) {
    const item = itemInfoMap.get(Number(fruitId) || 0);
    if (!item) return false;
    return String(item.asset_name || "").startsWith("gold/");
}

/**
 * 解析植物变异配置 (从 mutant_effect_plant 字段)
 */
function getPlantMutantConfig(plantId) {
    const plant = plantMap.get(plantId);
    if (!plant || !plant.mutant_effect_plant) return [];
    const raw = String(plant.mutant_effect_plant).trim();
    if (!raw) return [];
    const entries = raw.split(";").filter(Boolean);
    const result = [];
    for (const entry of entries) {
        const parts = entry.split(":");
        if (parts.length >= 3) {
            result.push({
                phase: parts[0],
                targetPlantId: Number(parts[1]) || 0,
                probability: Number(parts[2]) || 1,
            });
        }
    }
    return result;
}

/**
 * 根据植物ID和目标植物ID确定变异类型名称
 */
function determineMutationType(sourcePlantId, targetPlantId, sourceName, targetName) {
    if (!targetName && !sourceName) return null;
    const name = targetName || sourceName || "";
    const srcName = sourceName || "";

    // 月华 mutation - target name contains 月华
    if (name.includes("月华") || srcName.includes("月华")) return "月华";
    
    // 塔塔 mutation - target/source related to 塔
    if (name.includes("塔") || srcName.includes("塔") || srcName.includes("哈哈")) return "塔塔";
    
    // 荷华 mutation - plants that mutate to 荷花
    if (name.includes("荷花") || name.includes("荷") || srcName.includes("荷花") || srcName.includes("荷")) {
        return "荷华";
    }
    
    // 黄金 mutation - golden plants
    if (name.startsWith("黄金·") || srcName.startsWith("黄金·")) {
        return "黄金";
    }

    return null;
}

/**
 * 确定变异品质等级
 */
function determineMutationQuality(mutationType, plantLevel) {
    if (mutationType === "月华" || mutationType === "塔塔") return "天工";
    if (mutationType === "荷华") {
        // High-level lotus -> 珍品, lower -> 稀有
        if (plantLevel >= 100) return "珍品";
        return "稀有";
    }
    if (mutationType === "黄金") {
        if (plantLevel >= 200) return "天工";
        if (plantLevel >= 100) return "珍品";
        return "稀有";
    }
    return "无";
}

/**
 * 根据果实ID获取变异类型
 */
function getMutationTypeByFruitId(fruitId) {
    if (isGoldenFruit(fruitId)) {
        const item = itemInfoMap.get(Number(fruitId) || 0);
        const level = Number(item && item.level) || 0;
        const quality = level >= 200 ? "天工" : (level >= 100 ? "珍品" : "稀有");
        return { type: "黄金", quality: quality };
    }
    return null;
}

/**
 * 综合解析变异信息 - 主入口
 */
function resolveMutationInfo(plantId, mutantConfigIds) {
    const plant = plantMap.get(plantId);
    const plantName = plant ? plant.name : "";
    const configs = getPlantMutantConfig(plantId);
    const isGolden = isGoldenPlant(plantId);
    const confidence = [];

    // Check each possible mutation target
    for (const cfg of configs) {
        const targetPlant = plantMap.get(cfg.targetPlantId);
        const targetName = targetPlant ? targetPlant.name : "";
        const mType = determineMutationType(plantId, cfg.targetPlantId, plantName, targetName);
        if (mType) {
            const q = determineMutationQuality(mType, targetPlant ? Number(targetPlant.exp) || 0 : 0);
            const mKey = mType === "荷华" ? (mType + "_" + q) : (mType === "黄金" ? (mType + "_" + q) : mType);
            confidence.push({
                mutationType: mType,
                mutationKey: mKey,
                quality: q,
                targetPlantId: cfg.targetPlantId,
                targetName: targetName,
                phase: cfg.phase,
                weight: cfg.probability,
            });
        }
    }

    // Also check if this plant itself is a golden/mutant plant
    let selfType = null;
    let selfQuality = null;
    if (isGolden) {
        selfType = "黄金";
        selfQuality = determineMutationQuality(selfType, plant ? Number(plant.exp) || 0 : 0);
    } else if (plantName.includes("月华")) {
        selfType = "月华";
        selfQuality = "天工";
    } else if (plantName.includes("塔")) {
        selfType = "塔塔";
        selfQuality = "天工";
    } else if (plantName === "荷花") {
        selfType = "荷华";
        selfQuality = determineMutationQuality(selfType, plant ? Number(plant.exp) || 0 : 0);
    }

    // Determine display type - only when actual mutation occurred
    const hasMutantConfigIds = Array.isArray(mutantConfigIds) && mutantConfigIds.length > 0;
    let displayType = null;
    let displayQuality = null;
    if (hasMutantConfigIds && confidence.length > 0) {
        // Try to match actual mutation config IDs to determine which mutation occurred
        const ids = mutantConfigIds.map(Number).filter(Boolean);
        for (const cfg of configs) {
            if (ids.includes(Number(cfg.targetPlantId)) || ids.includes(Number(cfg.plan_id))) {
                const found = confidence.find(c => c.targetPlantId === cfg.targetPlantId);
                if (found) {
                    displayType = found.mutationType;
                    displayQuality = found.quality;
                    break;
                }
            }
        }
        // Fallback: use first confidence entry if no match found
        if (!displayType) {
            displayType = confidence[0].mutationType;
            displayQuality = confidence[0].quality;
        }
    } else if (selfType) {
        displayType = selfType;
        displayQuality = selfQuality;
    }

    return {
        isMutant: (Array.isArray(mutantConfigIds) && mutantConfigIds.length > 0) || !!selfType,
        isGolden: isGolden,
        mutationType: displayType,
        mutationQuality: displayQuality,
        confidence: confidence,
        mutantConfigIds: Array.isArray(mutantConfigIds) ? mutantConfigIds.map(Number).filter(Boolean) : [],
    };
}

const itemInfoMap = new Map();  // item_id -> item
const seedItemMap = new Map();  // seed_id -> item(type=5)
const seedImageMap = new Map(); // seed_id -> image url
const seedAssetImageMap = new Map(); // asset_name (Crop_xxx) -> image url

/**
 * 加载配置文件
 */
function loadConfigs() {
    const configDir = getResourcePath('gameConfig');
    
    // 加载等级经验配置
    try {
        const roleLevelPath = path.join(configDir, 'RoleLevel.json');
        if (fs.existsSync(roleLevelPath)) {
            roleLevelConfig = JSON.parse(fs.readFileSync(roleLevelPath, 'utf8'));
            // 构建累计经验表
            levelExpTable = [];
            for (const item of roleLevelConfig) {
                levelExpTable[item.level] = item.exp;
            }
            console.warn(`[配置] 已加载等级经验表 (${roleLevelConfig.length} 级)`);
        }
    } catch (e) {
        console.warn('[配置] 加载 RoleLevel.json 失败:', e.message);
    }
    
    // 加载植物配置
    try {
        const plantPath = path.join(configDir, 'Plant.json');
        if (fs.existsSync(plantPath)) {
            plantConfig = JSON.parse(fs.readFileSync(plantPath, 'utf8'));
            plantMap.clear();
            seedToPlant.clear();
            fruitToPlant.clear();
            for (const plant of plantConfig) {
                plantMap.set(plant.id, plant);
                if (plant.seed_id) {
                    seedToPlant.set(plant.seed_id, plant);
                }
                if (plant.fruit && plant.fruit.id) {
                    fruitToPlant.set(plant.fruit.id, plant);
                }
            }
            console.warn(`[配置] 已加载植物配置 (${plantConfig.length} 种)`);
        }
    } catch (e) {
        console.warn('[配置] 加载 Plant.json 失败:', e.message);
    }

        // 加载变异类型配置
    try {
        const mutantTypesPath = path.join(configDir, 'MutantTypes.json');
        if (fs.existsSync(mutantTypesPath)) {
            const mutantTypesData = JSON.parse(fs.readFileSync(mutantTypesPath, 'utf8'));
            const types = mutantTypesData && mutantTypesData.mutationTypes;
            if (types) {
                mutantTypeMap.clear();
                for (const [typeName, typeConfig] of Object.entries(types)) {
                    mutantTypeMap.set(typeName, typeConfig);
                }
                console.warn('[配置] 已加载变异类型配置 (' + mutantTypeMap.size + ' 种)');
            }
        }
    } catch (e) {
        console.warn('[配置] 加载 MutantTypes.json 失败:', e.message);
    }
    
    // 加载物品配置（含种子/果实价格）
    try {
        const itemInfoPath = path.join(configDir, 'ItemInfo.json');
        if (fs.existsSync(itemInfoPath)) {
            itemInfoConfig = JSON.parse(fs.readFileSync(itemInfoPath, 'utf8'));
            itemInfoMap.clear();
            seedItemMap.clear();
            for (const item of itemInfoConfig) {
                const id = Number(item && item.id) || 0;
                if (id <= 0) continue;
                itemInfoMap.set(id, item);
                if (Number(item.type) === 5) {
                    seedItemMap.set(id, item);
                }
            }
            console.warn(`[配置] 已加载物品配置 (${itemInfoConfig.length} 项)`);
        }
    } catch (e) {
        console.warn('[配置] 加载 ItemInfo.json 失败:', e.message);
    }

    // 加载种子图片映射（seed_images_named）
    try {
        const seedImageDir = path.join(configDir, 'seed_images_named');
        seedImageMap.clear();
        seedAssetImageMap.clear();
        if (fs.existsSync(seedImageDir)) {
            const files = fs.readdirSync(seedImageDir);
            for (const file of files) {
                const filename = String(file || '');
                const fileUrl = `/game-config/seed_images_named/${encodeURIComponent(file)}`;

                // 1) id_..._Seed.png 命名，按 id 建立映射
                const byId = filename.match(/^(\d+)_.*\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (byId) {
                    const seedId = Number(byId[1]) || 0;
                    if (seedId > 0 && !seedImageMap.has(seedId)) {
                        seedImageMap.set(seedId, fileUrl);
                    }
                }

                // 2) ...Crop_xxx_Seed.png 命名，按 asset_name 建立映射
                const byAsset = filename.match(/(Crop_\d+)_Seed\.(?:png|jpg|jpeg|webp|gif)$/i);
                if (byAsset) {
                    const assetName = byAsset[1];
                    if (assetName && !seedAssetImageMap.has(assetName)) {
                        seedAssetImageMap.set(assetName, fileUrl);
                    }
                }
            }
            console.warn(`[配置] 已加载种子图片映射 (${seedImageMap.size} 项)`);
        }
    } catch (e) {
        console.warn('[配置] 加载 seed_images_named 失败:', e.message);
    }
}

// ============ 等级经验相关 ============

/**
 * 获取等级经验表
 */
function getLevelExpTable() {
    return levelExpTable;
}

/**
 * 计算当前等级的经验进度
 * @param {number} level - 当前等级
 * @param {number} totalExp - 累计总经验
 * @returns {{ current: number, needed: number }} 当前等级经验进度
 */
function getLevelExpProgress(level, totalExp) {
    if (!levelExpTable || level <= 0) return { current: 0, needed: 0 };
    
    const currentLevelStart = levelExpTable[level] || 0;
    const nextLevelStart = levelExpTable[level + 1] || (currentLevelStart + 100000);
    
    const currentExp = Math.max(0, totalExp - currentLevelStart);
    const neededExp = nextLevelStart - currentLevelStart;
    
    return { current: currentExp, needed: neededExp };
}

// ============ 植物配置相关 ============

/**
 * 根据植物ID获取植物信息
 * @param {number} plantId - 植物ID
 */
function getPlantById(plantId) {
    return plantMap.get(plantId);
}

/**
 * 根据种子ID获取植物信息
 * @param {number} seedId - 种子ID
 */
function getPlantBySeedId(seedId) {
    return seedToPlant.get(seedId);
}

/**
 * 获取植物名称
 * @param {number} plantId - 植物ID
 */
function getPlantName(plantId) {
    const plant = plantMap.get(plantId);
    return plant ? plant.name : `植物${plantId}`;
}

/**
 * 根据种子ID获取植物名称
 * @param {number} seedId - 种子ID
 */
function getPlantNameBySeedId(seedId) {
    const plant = seedToPlant.get(seedId);
    return plant ? plant.name : `种子${seedId}`;
}

/**
 * 获取植物的生长时间（秒）
 * @param {number} plantId - 植物ID
 */
function getPlantGrowTime(plantId) {
    const plant = plantMap.get(plantId);
    if (!plant || !plant.grow_phases) return 0;
    
    // 解析 "种子:30;发芽:30;成熟:0;" 格式
    const phases = plant.grow_phases.split(';').filter(p => p);
    let totalSeconds = 0;
    for (const phase of phases) {
        const match = phase.match(/:(\d+)/);
        if (match) {
            totalSeconds += Number.parseInt(match[1]);
        }
    }
    return totalSeconds;
}

/**
 * 格式化时间
 * @param {number} seconds - 秒数
 */
function formatGrowTime(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
}

/**
 * 获取植物的收获经验
 * @param {number} plantId - 植物ID
 */
function getPlantExp(plantId) {
    const plant = plantMap.get(plantId);
    return plant ? plant.exp : 0;
}

/**
 * 根据果实ID获取植物名称
 * @param {number} fruitId - 果实ID
 */
function getFruitName(fruitId) {
    const plant = fruitToPlant.get(fruitId);
    return plant ? plant.name : `果实${fruitId}`;
}

/**
 * 根据果实ID获取植物信息
 * @param {number} fruitId - 果实ID
 */
function getPlantByFruitId(fruitId) {
    return fruitToPlant.get(fruitId);
}

/**
 * 获取所有种子信息（用于备选）
 */
function getAllSeeds() {
    return Array.from(seedToPlant.values()).map(p => ({
        seedId: p.seed_id,
        name: p.name,
        requiredLevel: Number(p.land_level_need) || 0,
        price: getSeedPrice(p.seed_id),
        image: getSeedImageBySeedId(p.seed_id),
    }));
}

function getMappedSeedImage(targetId) {
    const id = Number(targetId) || 0;
    if (id <= 0) return '';

    const direct = seedImageMap.get(id);
    if (direct) return direct;

    const item = itemInfoMap.get(id);
    const assetName = item && item.asset_name ? String(item.asset_name).trim() : '';
    if (!assetName) return '';

    return seedAssetImageMap.get(assetName) || '';
}

function getSeedImageBySeedId(seedId) {
    return getMappedSeedImage(seedId);
}

function getItemImageById(itemId) {
    const id = Number(itemId) || 0;
    if (id <= 0) return '';

    // 内部函数：根据 ID 获取图片
    const getImg = (targetId) => {
        // 1. 优先按物品ID命中（如 20003_胡萝卜_Crop_3_Seed.png）
        const direct = seedImageMap.get(targetId);
        if (direct) return direct;

        // 2. 其次按 ItemInfo.asset_name 命中（如 Crop_3_Seed.png）
        const item = itemInfoMap.get(targetId);
        const assetName = item && item.asset_name ? String(item.asset_name) : '';
        if (assetName) {
            const byAsset = seedAssetImageMap.get(assetName);
            if (byAsset) return byAsset;
        }
        return '';
    };

    // 1. 尝试直接获取
    let img = getImg(id);
    if (img) return img;

    // 2. 如果是果实，尝试获取对应的种子图片
    const plant = getPlantByFruitId(id);
    if (plant && plant.seed_id) {
        img = getImg(plant.seed_id);
        if (img) return img;
    }

    return '';
}

function getItemById(itemId) {
    return itemInfoMap.get(Number(itemId) || 0);
}

function getSeedPrice(seedId) {
    const item = seedItemMap.get(Number(seedId) || 0);
    return item ? (Number(item.price) || 0) : 0;
}

function getFruitPrice(fruitId) {
    const item = itemInfoMap.get(Number(fruitId) || 0);
    return item ? (Number(item.price) || 0) : 0;
}

function getAllPlants() {
    return Array.from(plantMap.values());
}

function getAllItems() {
    return Array.from(itemInfoMap.values());
}

// 启动时加载配置
loadConfigs();

module.exports = {
    loadConfigs,
    getAllItems,
    getAllPlants,
    getAllSeeds,
    // 等级经验
    getLevelExpTable,
    getLevelExpProgress,
    // 植物配置
    getPlantById,
    getPlantBySeedId,
    getPlantName,
    getPlantNameBySeedId,
    getPlantGrowTime,
    getPlantExp,
    formatGrowTime,
    // 果实配置
    getFruitName,
    getPlantByFruitId,
    getItemById,
    getItemImageById,
    getSeedPrice,
    getFruitPrice,
    getSeedImageBySeedId,
    // 变异配置
    getMutantType,
    getMutantTypesByQuality,
    getAllMutantTypes,
    isGoldenPlant,
    isGoldenFruit,
    getPlantMutantConfig,
    resolveMutationInfo,
    determineMutationType,
    getMutationTypeByFruitId,
};