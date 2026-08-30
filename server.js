const express = require('express');
const { parseStringPromise } = require('xml2js');
const crypto = require('crypto');

const app = express();
app.use(express.text({ type: 'text/xml' }));

const APP_ID = 'wx7f168d989a6c7506';
const MCH_ID = '1745856919';
const API_KEY = 'ajZhuDeCai2026wxpay87654321abcde';
const ENV_ID = 'cloud1-d5g9b9aeeb3aee56c';
const TEMPLATE_ID = 'FAmLUHv0v2Ro9jYgZhA0vHMGEtKja7_REoIOyCfv92M';

function md5(str) { return crypto.createHash('md5').update(str, 'utf8').digest('hex'); }

function verifySign(xml) {
  const data = {};
  xml.replace(/<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g, (_, k, v) => data[k] = v);
  xml.replace(/<(\w+)>([^<]+)<\/\1>/g, (_, k, v) => data[k] = v);
  const sign = data.sign;
  delete data.sign;
  const keys = Object.keys(data).sort();
  let str = keys.map(k => `${k}=${data[k]}`).join('&') + `&key=${API_KEY}`;
  return md5(str).toUpperCase() === sign;
}

app.post('/payNotify', async (req, res) => {
  try {
    if (!verifySign(req.body)) return res.status(403).send('FAIL');
    const data = {};
    req.body.replace(/<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>/g, (_, k, v) => data[k] = v);
    if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS') {
      return res.send('<xml><return_code><![CDATA[SUCCESS]]></return_code></xml>');
    }
    const outTradeNo = data.out_trade_no;
    const totalFee = data.total_fee;
    const transactionId = data.transaction_id;
    console.log(`[payNotify] 订单 ${outTradeNo} 付款成功，金额 ${totalFee}`);
    await updateOrderStatus(outTradeNo, transactionId);
    res.send('<xml><return_code><![CDATA[SUCCESS]]></return_code></xml>');
  } catch (e) {
    console.error('[payNotify] 错误:', e.message);
    res.send('<xml><return_code><![CDATA[SUCCESS]]></return_code></xml>');
  }
});

async function updateOrderStatus(orderNo, transactionId) {
  const tokenRes = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APP_ID}&secret=e9fc23e7006a3d219451e979ccfd4197`);
  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;
  const updateBody = {
    env: ENV_ID,
    query: `db.collection('orders').where({orderNo:'${orderNo}'}).update({data:{payStatus:1,status:'pending',transactionId:'${transactionId}',payTime:db.serverDate()}})`
  };
  await fetch(`https://api.weixin.qq.com/tcb/databaseupdate?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updateBody)
  });
  console.log(`[payNotify] 订单状态已更新: ${orderNo}`);
  try {
    const merchRes = await fetch(`https://api.weixin.qq.com/tcb/databasemongodb?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: ENV_ID, query: "db.collection('merchants').get()" })
    });
    const merchData = await merchRes.json();
    const merchants = merchData?.resp_data?.[0]?.data?.merchants || [];
    for (const m of merchants) {
      if (m.openid) {
        await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            touser: m.openid,
            template_id: TEMPLATE_ID,
            data: { thing1: { value: '新订单' }, time2: { value: new Date().toLocaleString('zh-CN') }, thing3: { value: `订单号:${orderNo}` } }
          })
        });
      }
    }
    console.log(`[payNotify] 已发送订阅消息通知给 ${merchants.length} 个商家`);
  } catch (e) {
    console.error('[payNotify] 发送通知失败:', e.message);
  }
}

app.get('/', (req, res) => res.send('OK - ajie pay callback server running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
