const { Buffer } = require('node:buffer');

const { sendMsgAsync, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toLong, toNum, log } = require('../utils/utils');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');
const path = require('node:path');
const CAPITAL_MODE_FILE = path.join(__dirname, '..', 'data', 'capital-mode.json');

const DOG_FOOD_IDS = [90004, 90005, 90006];
const DOG_FOOD_DAYS = { 90004: 1, 90005: 3, 90006: 5 };
const DOG_FOOD_SECS = { 90004: 86400, 90005: 259200, 90006: 432000 };
const MAX_FEED_SECS = 2592000; // 30天 = 30*24*3600秒
const PET_SHOP_ID = 3;

let getFriendsListFn = null;
function setFriendListProvider(fn) { getFriendsListFn = fn; }

const DOG_TYPE_NAMES = { 90001: '田园犬', 90002: '牧羊犬', 90003: '斑点狗', 90011: '柯基', 90021: '护主犬' };
const DOG_QUALITY_NAMES = { 100: '普通', 200: '稀有', 300: '珍品', 500: '天工' };
const DOG_QUALITY_COLORS = { 100: '#9ca3af', 200: '#60a5fa', 300: '#f59e0b', 500: '#a855f7' };
const DOG_GUARD_RATES = { 100: 0.30, 200: 0.55, 300: 0.75, 500: 0.92 };
const DOG_DESCRIPTIONS = {
  90001: '忠诚可靠的农家伙伴，守护农田的好帮手',
  90002: '聪明机警的牧羊能手，反应迅速',
  90003: '活泼机灵的小卫士，警觉性极高',
  90011: '短小精悍，嗅觉灵敏，擅长发现异常',
  90021: '勇猛忠诚的守护者，威震四方',
};

function readVarint(buf, offset) {
  if (offset >= buf.length) return null;
  let value = 0n, shift = 0n, idx = offset;
  while (idx < buf.length) {
    const byte = BigInt(buf[idx++]);
    value |= (byte & 0x7Fn) << shift;
    if ((byte & 0x80n) === 0n) return { value, offset: idx };
    shift += 7n;
    if (shift > 63n) return null;
  }
  return null;
}

function getDefaultQualityLevel(dogTypeId) {
  var map = { 90001: 200, 90002: 100, 90003: 300, 90011: 300, 90021: 500 };
  return map[Number(dogTypeId)] || 100;
}

function parseRawFields(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
  const fields = {};
  let offset = 0;
  while (offset < buf.length) {
    const key = readVarint(buf, offset);
    if (!key) break;
    offset = key.offset;
    const fieldNum = Number(key.value >> 3n);
    const wireType = Number(key.value & 0x07n);
    if (wireType === 0) {
      const v = readVarint(buf, offset);
      if (!v) break;
      fields['f' + fieldNum] = Number(v.value);
      offset = v.offset;
    } else if (wireType === 2) {
      const len = readVarint(buf, offset);
      if (!len) break;
      const data = buf.slice(len.offset, len.offset + Number(len.value));
      try {
        const str = data.toString('utf-8');
        fields['f' + fieldNum] = /^[\x20-\x7E\u4e00-\u9fff]+$/.test(str) ? str : data.toString('hex');
      } catch { fields['f' + fieldNum] = data.toString('hex'); }
      offset = len.offset + Number(len.value);
    } else break;
  }
  return fields;
}

// ============ 宠物商店 ============
async function getPetShopItems() {
  const body = types.ShopInfoRequest.encode(types.ShopInfoRequest.create({ shop_id: toLong(PET_SHOP_ID) })).finish();
  const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'ShopInfo', body);
  return Array.from(types.ShopInfoReply.decode(replyBody).goods_list || []);
}

async function buyPetShopGoods(goodsId, count = 1, price = 0) {
  const body = types.BuyGoodsRequest.encode(types.BuyGoodsRequest.create({
    goods_id: Number(goodsId) || 0, num: Number(count) || 1, price: Number(price) || 0,
  })).finish();
  const { body: replyBody } = await sendMsgAsync('gamepb.shoppb.ShopService', 'BuyGoods', body);
  return types.BuyGoodsReply.decode(replyBody);
}

// ============ 获取宠物列表 ============
async function getPetList() {
  try {
    const body = types.GetPetListRequest.encode(types.GetPetListRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.dogpb.DogService', 'GetPetList', body, 10000);
    if (replyBody && replyBody.length > 0) {
      return types.GetPetListReply.decode(replyBody);
    }
  } catch (e) {
    log('宠物', 'GetPetList 失败: ' + (e.message || e));
  }
  return null;
}

// ============ 上阵狗 ============
async function deployDog(dogTypeId) {
  var body = types.DeployDogRequest.encode(types.DeployDogRequest.create({
    dog_type_id: toLong(dogTypeId),
  })).finish();
  try {
    var { body: replyBody } = await sendMsgAsync('gamepb.dogpb.DogService', 'DeployDog', body, 10000);
    log("宠物", (DOG_TYPE_NAMES[dogTypeId] || dogTypeId) + "已上阵");
    return replyBody ? types.DeployDogReply.decode(replyBody) : null;
  } catch (e) {
    var msg = String(e && e.message || "");
    if (msg.includes("1007006")) {
      return null; // 已经上阵了也算成功
    }
    if (!msg.includes("1007004")) { log("宠物", "上阵 DeployDog => " + msg.substring(0, 90)); }
    throw new Error('上阵失败: ' + (e.message || e));
  }
}

async function recallDog(dogId) {
  var emptyBody = types.RecallDogRequest.encode(types.RecallDogRequest.create({})).finish();
  var combos = [
    ['gamepb.dogpb.DogService', 'WithdrawDog', emptyBody],
    ['gamepb.dogpb.DogService', 'RecallDog', emptyBody],
    ['gamepb.dogpb.DogService', 'RecallPet', emptyBody],
  ];
  for (var ci = 0; ci < combos.length; ci++) {
    try {
      var { body: replyBody } = await sendMsgAsync(combos[ci][0], combos[ci][1], combos[ci][2], 10000);
      if (replyBody && replyBody.length > 0) {
        log("宠物", "已收回");
        return replyBody;
      }
    } catch (e) {
      var msg = String(e && e.message || '');
      if (msg.includes('1007008')) { return Buffer.from([]); }
      log('宠物', '收回尝试 ' + combos[ci][0] + '.' + combos[ci][1] + ' => ' + msg.substring(0, 80));
    }
  }
  var errors = combos.map(function(c_) { return c_[0] + '.' + c_[1]; }).join(', ');
  throw new Error('收起失败: 所有方法均失败 (' + errors + ')');
}

async function getDogFoodList() {
  try {
    const body = types.GetDogFoodListRequest.encode(types.GetDogFoodListRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.dogpb.DogService', 'GetDogFoodList', body, 10000);
    if (replyBody && replyBody.length > 0) {
      return types.GetDogFoodListReply.decode(replyBody);
    }
  } catch (e) {
    var _msg = String(e && e.message || ''); if (_msg.includes('1020002')) { /* 网络繁忙，不打印日志 */ } else { log('宠物', 'GetDogFoodList 失败: ' + _msg); }
  }
  return { foods: [] };
}

// ============ 获取自家狗信息 ============
async function getOwnDogInfo() {
  const { body: replyBody } = await sendMsgAsync('gamepb.dogpb.DogService', 'GetDogInfo', Buffer.from([]), 10000);
  if (!replyBody || replyBody.length === 0) return null;

  const raw = Buffer.from(replyBody);
  const fields = parseRawFields(raw);
  // 即使没有狗上阵 (f2=undefined)，服务器也可能返回食物信息 (f3/f4/f5)
  // 不要提前 return null，继续解析食物数据

  let dogTypes = [];
  if (fields.f1) {
    try {
      const info = types.DogInfo.decode(raw);
      if (info.dog_types) {
        for (const dt of info.dog_types) {
          const id = Number(dt.dog_type_id);
          dogTypes.push({ id, name: dt.name, growTime: Number(dt.grow_up_time), qualityLevel: getDefaultQualityLevel(id), field4: Number(dt.field_4) || 0, field7: Number(dt.field_7) || 0 });
          DOG_TYPE_NAMES[id] = dt.name;
        }
      }
    } catch (e) {
      log('宠物', 'DogInfo proto decode failed: ' + e.message + '，使用静态目录');
    }
  }
  // 如果 proto 解码后 dogTypes 仍为空，从静态目录补全
  if (dogTypes.length === 0) {
    const activeDogId = fields.f2 !== undefined ? Number(fields.f2) : 0;
    for (const [idStr, name] of Object.entries(DOG_TYPE_NAMES)) {
      const id = Number(idStr);
      let qLevel = 100;
      if (id === 90001) qLevel = 200;
      else if (id === 90002) qLevel = 100;
      else if (id === 90003) qLevel = 300;
      else if (id === 90011) qLevel = 300;
      else if (id === 90021) qLevel = 500;
      dogTypes.push({ id, name, growTime: 0, qualityLevel: qLevel, field4: 0, field7: id === activeDogId ? 1 : 0 });
    }
    log('宠物', '使用静态目录构建了 ' + dogTypes.length + ' 只狗的类型数据');
  }

  const dogTypeId = fields.f2 !== undefined ? Number(fields.f2) : 0;
  const dogName = dogTypeId > 0 ? (DOG_TYPE_NAMES[dogTypeId] || ('未知#' + dogTypeId)) : '未上阵';
  const foodRemainSec = fields.f3 !== undefined ? Number(fields.f3) : 0;
  const foodTotalCap = fields.f4 !== undefined ? Number(fields.f4) : 0;

  let activeFoodItems = [];
  if (fields.f5) {
    try {
      const info = types.DogInfo.decode(raw);
      if (info.food_items) {
        for (const fi of info.food_items) {
          activeFoodItems.push({ foodId: Number(fi.food_id), durationSec: Number(fi.duration_sec), count: Number(fi.count) });
        }
      }
    } catch (e) {
      // ignore food item decode error
    }
  }

  const fed = foodRemainSec > 0;
  return { dogTypeId, dogName, foodRemainSec, foodTotalCap, fed, dogTypes, activeFoodItems };
}

// ============ 获取狗状态（完整数据） ============
let _probedTypesCache = null;
let _probedTypesTime = 0;
const PROBE_CACHE_MS = 300000; // 5分钟

async function getDogStatus(friendGid) {
  if (friendGid) {
    return await visitAndGetDogInfo(friendGid, 2);
  }
  try {
    const info = await getOwnDogInfo();
    const originalDogTypeId = info ? info.dogTypeId : 0;

    // 缓存探测结果，不每次都跑（避免频繁上阵收回）
    let probedTypes = _probedTypesCache;
    if (!probedTypes || Date.now() - _probedTypesTime > PROBE_CACHE_MS) {
      try {
        probedTypes = await probeOwnedDogTypes();
        _probedTypesCache = probedTypes;
        _probedTypesTime = Date.now();
      } catch (e) {
        log('宠物', '拥有权探测失败: ' + (e.message || e));
      }
    }

    // 如果有狗原来上阵，探测后重新部署回去
    if (originalDogTypeId > 0 && probedTypes[originalDogTypeId]) {
      try { await deployDog(originalDogTypeId); } catch (e) {
        log('宠物', '探测后恢复上阵失败: ' + (e.message || e));
      }
    }

    if (!info) {
      // 没有狗上阵，用探针结果构建回退数据
      const fallbackDogTypes = [];
      const typeEntries = [
        [90001, '田园犬', 200], [90002, '牧羊犬', 100],
        [90003, '斑点狗', 300], [90011, '柯基', 300], [90021, '护主犬', 500],
      ];
      for (const [id, name, ql] of typeEntries) {
        const owned = probedTypes[id] || false;
        fallbackDogTypes.push({ id, name, growTime: 0, qualityLevel: ql, field4: 0, field7: owned ? 1 : 0 });
      }
      return {
        gid: 0, isOwn: true,
        dogTypeId: 0, dogName: '未知',
        foodRemainSec: 0, foodTotalCap: 0, fed: false,
        statusText: '未知', qualityLevel: 100,
        qualityName: '普通', qualityColor: '#9ca3af',
        guardRate: 0.30, description: '',
        dogTypes: fallbackDogTypes,
        activeFoodItems: [], activeFoodSummary: '',
      };
    }
    // 有狗上阵，用探针结果覆盖 dogTypes 的 field7
    const qualityLevel = getDefaultQualityLevel(originalDogTypeId);
    let activeFoodSummary = '';
    if (info.activeFoodItems && info.activeFoodItems.length > 0) {
      activeFoodSummary = info.activeFoodItems.map(f => {
        const days = DOG_FOOD_DAYS[f.foodId] || Math.round((f.durationSec || 86400) / 86400);
        return days + '天x' + f.count;
      }).join(', ');
    }
    return {
      gid: 0, isOwn: true,
      dogTypeId: originalDogTypeId,
      dogName: info.dogName,
      foodRemainSec: info.foodRemainSec,
      foodTotalCap: info.foodTotalCap,
      fed: info.fed,
      statusText: info.fed ? '看护中' : '休息中',
      qualityLevel: getDefaultQualityLevel(originalDogTypeId),
      qualityName: DOG_QUALITY_NAMES[qualityLevel] || '普通',
      qualityColor: DOG_QUALITY_COLORS[qualityLevel] || '#9ca3af',
      guardRate: DOG_GUARD_RATES[qualityLevel] || 0.30,
      description: DOG_DESCRIPTIONS[originalDogTypeId] || '',
      dogTypes: (info.dogTypes || []).map(dt => ({
        id: dt.id, name: dt.name, growTime: dt.growTime,
        qualityLevel: getDefaultQualityLevel(dt.id),
        field4: dt.field4 || 0,
        field7: probedTypes[dt.id] ? 1 : 0,
      })),
      activeFoodItems: info.activeFoodItems,
      activeFoodSummary: activeFoodSummary,
    };
    } catch (e) {
    log('宠物', 'getOwnDogInfo 失败，使用 getPetList: ' + (e.message || e));
    const reply = await getPetList();
    if (!reply) return null;
    return transformPetListReply(reply);
  }
}

function transformPetListReply(reply) {
  const dogTypeId = Number(reply.dog_type_id);
  const foodRemainSec = Number(reply.food_remain_sec || 0);
  const foodTotalCap = Number(reply.food_total_cap || 0);
  const dogTypes = (reply.dog_types || []).map(dt => ({
    id: Number(dt.dog_type_id), name: dt.name,
    growTime: Number(dt.grow_up_time), qualityLevel: getDefaultQualityLevel(Number(dt.dog_type_id)),
    field4: Number(dt.field_4) || 0, field7: 1,
  }));
  const qualityLevel = getDefaultQualityLevel(dogTypeId);
  let activeFoodSummary = '';
  if (reply.food_items && reply.food_items.length > 0) {
    activeFoodSummary = reply.food_items.map(f => {
      const days = DOG_FOOD_DAYS[Number(f.food_id)] || Math.round((Number(f.duration_sec) || 86400) / 86400);
      return days + '天x' + f.count;
    }).join(', ');
  }
  return {
    gid: 0, isOwn: true,
    dogTypeId: dogTypeId,
    dogName: DOG_TYPE_NAMES[dogTypeId] || ('未知#' + dogTypeId),
    foodRemainSec: foodRemainSec,
    foodTotalCap: foodTotalCap,
    fed: foodRemainSec > 0,
    statusText: foodRemainSec > 0 ? '看护中' : '休息中',
    qualityLevel: getDefaultQualityLevel(dogTypeId),
    qualityName: DOG_QUALITY_NAMES[qualityLevel] || '普通',
    qualityColor: DOG_QUALITY_COLORS[qualityLevel] || '#9ca3af',
    guardRate: DOG_GUARD_RATES[qualityLevel] || 0.30,
    description: DOG_DESCRIPTIONS[dogTypeId] || '',
    dogTypes: dogTypes,
    activeFoodItems: (reply.food_items || []).map(f => ({
      foodId: Number(f.food_id), durationSec: Number(f.duration_sec), count: Number(f.count),
    })),
    activeFoodSummary: activeFoodSummary,
  };
}

// ============ 访问好友获取狗信息 ============
async function visitAndGetDogInfo(hostGid, reason) {
  const body = types.VisitEnterRequest.encode(types.VisitEnterRequest.create({
    host_gid: toLong(hostGid), reason: Number(reason) || 2,
  })).finish();
  const { body: replyBody } = await sendMsgAsync('gamepb.visitpb.VisitService', 'Enter', body, 10000);
  if (!replyBody || replyBody.length === 0) return null;
  const reply = types.VisitEnterReply.decode(replyBody);
  const briefDog = reply.brief_dog_info;
  if (!briefDog || briefDog.length === 0) return null;
  const raw = Buffer.from(briefDog);
  const fields = parseRawFields(raw);
  const dogTypeId = fields.f1 !== undefined ? Number(fields.f1) : 0;
  const foodRemainSec = fields.f2 !== undefined ? Number(fields.f2) : 0;
  if (dogTypeId === 0) return null;
  const qualityLevel = getDefaultQualityLevel(dogTypeId);
  return {
    gid: hostGid, isOwn: false,
    dogTypeId, dogName: DOG_TYPE_NAMES[dogTypeId] || ('未知#' + dogTypeId),
    foodRemainSec, foodTotalCap: 0, fed: foodRemainSec > 0,
    statusText: foodRemainSec > 0 ? '看护中' : '休息中',
    qualityLevel, qualityName: DOG_QUALITY_NAMES[qualityLevel] || '普通', qualityColor: DOG_QUALITY_COLORS[qualityLevel] || '#9ca3af',
    guardRate: DOG_GUARD_RATES[qualityLevel] || 0.30, description: DOG_DESCRIPTIONS[dogTypeId] || '',
    dogTypes: [], activeFoodItems: [], activeFoodSummary: '',
    friendGid: hostGid,
  };
}

// ============ 喂食狗 ============
async function feedDog(itemId, count) {
  if (count === undefined || count === null) count = 1;
  if (!DOG_FOOD_IDS.includes(Number(itemId))) throw new Error('非法的狗粮ID: ' + itemId);

  // 检查30天上限（快速检查，超时则跳过避免阻塞喂食）
  try {
    const info = await Promise.race([
      getOwnDogInfo(),
      new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('timeout')); }, 3000);
      }),
    ]);
    if (info && info.foodRemainSec > 0) {
      var newFeedSecs = (DOG_FOOD_SECS[Number(itemId)] || 86400) * count;
      var totalSecs = info.foodRemainSec + newFeedSecs;
      if (totalSecs > MAX_FEED_SECS) {
        throw new Error('狗粮投喂已达30天上限');
      }
    }
  } catch (e) {
    if (e && e.message && e.message.indexOf('狗粮投喂已达30天上限') !== -1) throw e;
    // 超时或 getOwnDogInfo 失败时跳过检查，允许继续喂食
  }


  var protobuf = require('protobufjs');
  var bodySimple = (function() { var w = protobuf.Writer.create(); w.uint32(8).int64(Number(itemId)); w.uint32(16).int64(Number(count)); return w.finish(); })();
  var bodyUseReq = types.UseRequest.encode(types.UseRequest.create({ item_id: toLong(itemId), count: toLong(count), land_ids: [] })).finish();
  var bodyLand0 = types.UseRequest.encode(types.UseRequest.create({ item_id: toLong(itemId), count: toLong(count), land_ids: [0] })).finish();
  var bodyWrapped = (function() { var w = protobuf.Writer.create(); w.uint32(10).fork(); w.uint32(8).int64(Number(itemId)); w.uint32(16).int64(Number(count)); w.ldelim(); return w.finish(); })();

  var protobuf = require('protobufjs');
  // Try empty body
  var emptyBody = types.RecallDogRequest.encode(types.RecallDogRequest.create({})).finish();
  // Try body with dogId field (field 1 = int64)
  var bodyWithDogId = Buffer.from([]); // bodyWithDogId not used in combos
  var combos = [
    ['gamepb.dogpb.DogService','FeedDog',bodySimple], ['gamepb.dogpb.DogService','FeedDog',bodyUseReq],
    ['gamepb.dogpb.DogService','FeedDog',bodyWrapped], ['gamepb.dogpb.DogService','FeedDog',bodyLand0],
    ['gamepb.dogpb.DogService','Feed',bodySimple], ['gamepb.dogpb.DogService','Feed',bodyUseReq],
    ['gamepb.dogpb.DogService','UseItem',bodySimple], ['gamepb.dogpb.DogService','Use',bodySimple],
    ['gamepb.dogpb.DogService','AddFood',bodySimple], ['gamepb.dogpb.DogService','UseFood',bodySimple],
    ['gamepb.itempb.ItemService','Use',bodySimple], ['gamepb.itempb.ItemService','Use',bodyUseReq],
    ['gamepb.itempb.ItemService','Use',bodyLand0], ['gamepb.itempb.ItemService','UseDogFood',bodySimple],
    ['gamepb.itempb.ItemService','Feed',bodyUseReq],
    ['gamepb.petpb.PetService','Feed',bodySimple], ['gamepb.petpb.PetService','FeedDog',bodySimple],
    ['gamepb.userpb.UserService','UseDogFood',bodySimple], ['gamepb.userpb.UserService','FeedDog',bodySimple],
  ];

  var errors = [];
  for (var i = 0; i < combos.length; i++) {
    var svc = combos[i][0], method = combos[i][1], body = combos[i][2];
    try {
      var { body: replyBody } = await sendMsgAsync(svc, method, body, 10000);
      if (replyBody && replyBody.length > 0) {
        log('宠物', '喂食成功');
        return { success: true, source: svc + '.' + method };
      }
    } catch (e) {
      var msg = String((e && e.message) || '').substring(0, 80);
      if (msg.includes('unimplemented') || msg.includes('not found')) continue;
      errors.push({ svc: svc, method: method, error: msg });
    }
  }

  var byCode = {};
  for (var i = 0; i < errors.length; i++) {
    var e = errors[i];
    var codeMatch = e.error.match(/code=(\d+)/);
    var key = codeMatch ? codeMatch[1] : e.error.substring(0, 20);
    if (!byCode[key]) byCode[key] = [];
    byCode[key].push(e.svc + '.' + e.method);
  }
  var codeKeys = Object.keys(byCode);
  for (var i = 0; i < codeKeys.length; i++) {
    log('宠物', '错误码 ' + codeKeys[i] + ': ' + byCode[codeKeys[i]].join(', '));
  }

  throw new Error('喂食失败，探测了' + combos.length + '种组合');
}
// ============ 更换狗屋 ============
async function changeDoghouse(itemId) {
  var body = types.UseRequest.encode(types.UseRequest.create({
    item_id: toLong(itemId), count: toLong(1), land_ids: [],
  })).finish();
  try {
    var { body: replyBody } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', body);
    return types.UseReply.decode(replyBody);
  } catch (e1) {
    if (String((e1 && e1.message) || '').includes('code=1000020')) {
      var protobuf = require('protobufjs');
      var w = protobuf.Writer.create();
      var iw = w.uint32(10).fork();
      iw.uint32(8).int64(toLong(itemId)); iw.uint32(16).int64(toLong(1)); iw.ldelim();
      var { body: fb } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', w.finish());
      return types.UseReply.decode(fb);
    }
    throw e1;
  }
}

// ============ 守护日志 ============
function extractItemRawBytes(replyBody) {
  const buf = Buffer.isBuffer(replyBody) ? replyBody : Buffer.from(replyBody || []);
  const items = [];
  let offset = 0;
  while (offset < buf.length) {
    const key = readVarint(buf, offset);
    if (!key) break;
    offset = key.offset;
    const fieldNum = Number(key.value >> 3n);
    const wireType = Number(key.value & 0x07n);
    if (fieldNum === 1 && wireType === 2) {
      const len = readVarint(buf, offset);
      if (!len) break;
      const itemBytes = buf.slice(len.offset, len.offset + Number(len.value));
      items.push(itemBytes);
      offset = len.offset + Number(len.value);
    } else {
      if (wireType === 0) {
        const v = readVarint(buf, offset);
        if (!v) break;
        offset = v.offset;
      } else if (wireType === 2) {
        const len = readVarint(buf, offset);
        if (!len) break;
        offset = len.offset + Number(len.value);
      } else break;
    }
  }
  return items;
}

function extractField9String(itemBytes) {
  const buf = Buffer.isBuffer(itemBytes) ? itemBytes : Buffer.from(itemBytes || []);
  let offset = 0;
  while (offset < buf.length) {
    const key = readVarint(buf, offset);
    if (!key) break;
    offset = key.offset;
    const fieldNum = Number(key.value >> 3n);
    const wireType = Number(key.value & 0x07n);
    if (wireType === 2) {
      const len = readVarint(buf, offset);
      if (!len) break;
      const data = buf.slice(len.offset, len.offset + Number(len.value));
      if (fieldNum === 9) return data.toString('utf-8');
      offset = len.offset + Number(len.value);
    } else if (wireType === 0) {
      const v = readVarint(buf, offset);
      if (!v) break;
      offset = v.offset;
    } else break;
  }
  return '';
}

async function getGuardLogs(page = 1, pageSize = 10) {
  try {
    const body = types.GetGuardLogsRequest.encode(types.GetGuardLogsRequest.create({
      page: toLong(0), page_size: toLong(200),
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.dogpb.DogService', 'GetProtectLogs', body, 10000);
    if (replyBody && replyBody.length > 0) {
      var reply = types.GetGuardLogsReply.decode(replyBody);
      if (reply.items) {
        var rawItemBytes = extractItemRawBytes(replyBody);
        for (var gi = 0; gi < reply.items.length; gi++) {
          var item = reply.items[gi];
          var rawTs = toNum(item.bite_count);
          var rawBites = toNum(item.gold_intercepted);
          var rawGold = toNum(item.timestamp);
          item.timestamp = rawTs;
          item.bite_count = rawBites;
          item.gold_intercepted = rawGold;
          item.friend_gid = toNum(item.friend_gid);
          var rawBytes = rawItemBytes[gi];
          if (rawBytes) item.dog_name = extractField9String(rawBytes) || item.dog_name || '';
        }
      }
      reply.total = toNum(reply.total);
      return reply;
    }
  } catch (e) {
    log('宠物', 'GetGuardLogs 失败: ' + (e.message || e));
  }
  return { items: [], total: 0 };
}

// ============ 护主奖励 ============
async function getGuardReward() {
  try {
    const body = types.GetGuardRewardRequest.encode(types.GetGuardRewardRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.dogpb.DogService', 'GetGuardReward', body, 10000);
    if (replyBody && replyBody.length > 0) {
      return types.GetGuardRewardReply.decode(replyBody);
    }
  } catch (e) {
    log('宠物', 'GetGuardReward 失败: ' + (e.message || e));
  }
  return { has_huzhu_dog: false, can_claim: false, rewards: [] };
}

async function claimGuardReward() {
  try {
    const body = types.ClaimGuardRewardRequest.encode(types.ClaimGuardRewardRequest.create({})).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.dogpb.DogService', 'ClaimGuardReward', body, 10000);
    if (replyBody && replyBody.length > 0) {
      return types.ClaimGuardRewardReply.decode(replyBody);
    }
  } catch (e) {
    log('宠物', 'ClaimGuardReward 失败: ' + (e.message || e));
  }
  return { items: [], bonus_items: [] };
}

// ============ 资本模式 ============
async function getCapitalMode() {
  var accountId = process.env.FARM_ACCOUNT_ID || 'default';
  try {
    var all = readJsonFile(CAPITAL_MODE_FILE, function() { return {}; });
    var cfg = all[accountId] || {};
    return {
      config: {
        enabled: !!cfg.enabled,
        seconds_before_mature: Number(cfg.secondsBeforeMature || cfg.seconds_before_mature || 10),
        selected_dog_id: Number(cfg.selectedDogId || cfg.selected_dog_id || 0),
      }
    };
  } catch (e) {
    log('宠物', '读取本地资本模式失败: ' + (e.message || e));
    return { config: { enabled: false, seconds_before_mature: 10, selected_dog_id: 0 } };
  }
}

async function setCapitalMode(config) {
  var accountId = process.env.FARM_ACCOUNT_ID || 'default';
  try {
    var all = readJsonFile(CAPITAL_MODE_FILE, function() { return {}; });
    all[accountId] = {
      enabled: !!config.enabled,
      secondsBeforeMature: Number(config.secondsBeforeMature || config.seconds_before_mature || 10),
      selectedDogId: Number(config.selectedDogId || config.selected_dog_id || 0),
    };
    writeJsonFileAtomic(CAPITAL_MODE_FILE, all);
    log('宠物', '资本模式已保存到本地: ' + accountId);
    // 保存时无条件收回当前已上阵的狗
    try { await recallDog(0); } catch (e) {}
    return { ok: true };
  } catch (e) {
    log('宠物', '保存本地资本模式失败: ' + (e.message || e));
    throw new Error('保存资本模式失败: ' + (e.message || e));
  }
}

function getCapitalModeConfig() {
  var accountId = process.env.FARM_ACCOUNT_ID || 'default';
  try {
    var all = readJsonFile(CAPITAL_MODE_FILE, function() { return {}; });
    var cfg = all[accountId] || {};
    return {
      enabled: !!cfg.enabled,
      secondsBeforeMature: Number(cfg.secondsBeforeMature || cfg.seconds_before_mature || 10),
      selectedDogId: Number(cfg.selectedDogId || cfg.selected_dog_id || 0),
    };
  } catch (e) {
    return { enabled: false, secondsBeforeMature: 10, selectedDogId: 0 };
  }
}

// ============ 从背包获取宠物信息 ============
function getPetBagInfo(bagReply) {
  var items = [];
  if (bagReply && bagReply.item_bag && bagReply.item_bag.items) {
    for (var i = 0; i < bagReply.item_bag.items.length; i++) {
      var item = bagReply.item_bag.items[i];
      var id = toNum(item && item.id), cnt = toNum(item && item.count);
      if (id && cnt > 0) items.push({ id: id, count: cnt });
    }
  }
  return {
    dogFoods: items.filter(function(i) { return DOG_FOOD_IDS.includes(i.id); }),
    doghouses: items.filter(function(i) { return i.id >= 205001 && i.id < 206000; }),
  };
}

// ============ 服务探测 ============
async function probeDogService() {
  var candidates = [
    { svc: 'gamepb.dogpb.DogService', methods: ['GetDogInfo', 'GetInfo', 'DogInfo', 'Info'] },
  ];
  var results = [];
  for (var ci = 0; ci < candidates.length; ci++) {
    var svc = candidates[ci].svc;
    for (var mi = 0; mi < candidates[ci].methods.length; mi++) {
      var method = candidates[ci].methods[mi];
      try {
        var { body: replyBody } = await sendMsgAsync(svc, method, Buffer.from([]), 10000);
        results.push({ svc: svc, method: method, ok: true, len: replyBody ? replyBody.length : 0 });
        log('宠物', '探测成功: ' + svc + '.' + method + ' reply=' + (replyBody ? replyBody.length : 0) + 'bytes');
      } catch (e) {
        var msg = String((e && e.message) || '').substring(0, 60);
        if (!msg.includes('unimplemented') && !msg.includes('not found') && !msg.includes('1000020')) {
          results.push({ svc: svc, method: method, ok: false, error: msg });
        }
      }
    }
  }
  return results;
}

// ============ 图鉴系统 ============
async function getIllustratedList(refresh) {
  try {
    const body = types.GetIllustratedListV2Request.encode(types.GetIllustratedListV2Request.create({
      refresh: !!refresh, full: true,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.illustratedpb.IllustratedService', 'GetIllustratedListV2', body, 10000);
    if (replyBody && replyBody.length > 0) {
      return types.GetIllustratedListV2Reply.decode(replyBody);
    }
  } catch (e) {
    log('图鉴', 'GetIllustratedListV2 失败: ' + (e.message || e));
  }
  return { items: [] };
}

async function claimAllIllustratedRewards() {
  try {
    const body = types.ClaimAllRewardsV2Request.encode(types.ClaimAllRewardsV2Request.create({
      only_claimable: true,
    })).finish();
    const { body: replyBody } = await sendMsgAsync('gamepb.illustratedpb.IllustratedService', 'ClaimAllRewardsV2', body, 10000);
    if (replyBody && replyBody.length > 0) {
      return types.ClaimAllRewardsV2Reply.decode(replyBody);
    }
  } catch (e) {
    log('图鉴', 'ClaimAllRewardsV2 失败: ' + (e.message || e));
  }
  return { items: [], bonus_items: [] };
}

// ============ 探测狗狗拥有权 ============

// ============ 简版收回（避免14种方法撑爆请求队列） ============
// ============ 探测狗狗拥有权 ============
async function probeOwnedDogTypes() {
  const result = {};
  const typeEntries = [
    [90001, '田园犬', 200], [90002, '牧羊犬', 100],
    [90003, '斑点狗', 300], [90011, '柯基', 300], [90021, '护主犬', 500],
  ];
  for (const [id] of typeEntries) {
    try {
      // 先收回已有狗，再尝试上阵探测
      try { await recallDog(0); } catch (e) { /* ignore */ }
      await deployDog(id);
      result[id] = true;
      // probed
    } catch (e) {
      result[id] = false;
    }
  }
  // 最后收回所有探测部署的狗
  try { await recallDog(0); } catch (e) { /* ignore */ }
  return result;
}
module.exports = {
  DOG_FOOD_IDS, DOG_FOOD_DAYS, DOG_FOOD_SECS, PET_SHOP_ID,
  DOG_TYPE_NAMES, DOG_QUALITY_NAMES, DOG_QUALITY_COLORS,
  DOG_GUARD_RATES, DOG_DESCRIPTIONS,
  setFriendListProvider,
  getPetShopItems, buyPetShopGoods,
  getPetList, deployDog, recallDog,
  feedDog, changeDoghouse, getPetBagInfo, getDogFoodList,
  getDogStatus, probeDogService, parseRawFields,
  getGuardLogs, getGuardReward, claimGuardReward,
  getCapitalMode, setCapitalMode, getCapitalModeConfig,
  getIllustratedList, claimAllIllustratedRewards,
};


