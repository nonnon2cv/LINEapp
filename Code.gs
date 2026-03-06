// ==========================================
// LINE予約ミニアプリ用 Google Apps Script (GAS) バックエンドコード
// ==========================================

// 連携するGoogleカレンダーのIDを指定します。
// （自分のメインカレンダーを使う場合は 'primary' のままでOKです。
// 特定のカレンダーを使いたい場合は、カレンダーの設定から「カレンダー ID」をコピーして書き換えてください。例: 'xxxx@group.calendar.google.com'）
const CALENDAR_ID = 'primary'; 

// 営業時間の設定
const OPEN_HOUR = 10; // 何時から
const CLOSE_HOUR = 18; // 何時まで
const SLOT_INTERVAL_MINUTES = 60; // 何分刻みで予約を取るか

/**
 * HTTP GETリクエストを受信したときの処理
 * 空き時間枠の取得に使用します。
 */
function doGet(e) {
  // CORS対策
  const headers = { "Access-Control-Allow-Origin": "*" };
  
  try {
    const action = e.parameter.action;
    const dateStr = e.parameter.date;

    if (action === 'getSlots' && dateStr) {
      const availableSlots = getAvailableSlots(dateStr);
      return createJsonResponse({ slots: availableSlots }, headers);
    }

    return createJsonResponse({ error: 'Invalid request' }, headers);
  } catch (error) {
    return createJsonResponse({ error: error.toString() }, headers);
  }
}

/**
 * HTTP POSTリクエストを受信したときの処理
 * 予約をカレンダーへ登録する際に使用します。
 */
function doPost(e) {
  const headers = { "Access-Control-Allow-Origin": "*" };

  try {
    // HTML側から送られてくるデータをJSONとして解釈
    // ※CORS制限を避けるため、text/plainで送られたJSON文字列をパースします
    const data = JSON.parse(e.postData.contents);
    const { name, phone, people, date, time, memo } = data;

    if (!name || !phone || !people || !date || !time) {
      return createJsonResponse({ error: '必須項目が不足しています。' }, headers);
    }

    // 予約直前に、まだその枠が空いているか最終確認
    const availableSlots = getAvailableSlots(date);
    if (!availableSlots.includes(time)) {
      return createJsonResponse({ error: '申し訳ありません。ご希望の時間はすでに埋まってしまいました。' }, headers);
    }

    // カレンダーに予定を追加
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    
    // 日付と時間をDateオブジェクトに変換
    const [year, month, day] = date.split('-');
    const [hour, minute] = time.split(':');
    
    const startTime = new Date(year, month - 1, day, hour, minute);
    // 終了時間は開始時間＋設定した予約の長さ
    const endTime = new Date(startTime.getTime() + (SLOT_INTERVAL_MINUTES * 60000)); 

    // カレンダーに表示する予定のタイトル
    const title = `【予約】${name} 様 (${people}名)`;
    
    // カレンダーの予定の詳細テキスト
    const description = 
`代表者: ${name} 様
電話番号: ${phone}
人数: ${people} 名

連絡事項・メモ:
${memo || '特になし'}
`;

    // カレンダーへ登録実行
    const event = calendar.createEvent(title, startTime, endTime, {
      description: description
    });

    return createJsonResponse({ 
      success: true, 
      message: '予約が完了しました。', 
      eventId: event.getId() 
    }, headers);

  } catch (error) {
    return createJsonResponse({ error: 'サーバーエラーが発生しました: ' + error.toString() }, headers);
  }
}

/**
 * 指定された日付の空き時間(配列)を算出する関数
 */
function getAvailableSlots(dateStr) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const [year, month, day] = dateStr.split('-');
  
  // 指定日の00:00:00 から 23:59:59 までのすべての予定を取得
  const checkDateStart = new Date(year, month - 1, day, 0, 0, 0);
  const checkDateEnd = new Date(year, month - 1, day, 23, 59, 59);
  const events = calendar.getEvents(checkDateStart, checkDateEnd);
  
  // 今日の場合は、現在時刻を過ぎた予約枠は除外するため基準時間を取得
  const now = new Date();
  
  const availableSlots = [];

  // OPEN_HOURからCLOSE_HOURまでの枠をチェック
  for (let h = OPEN_HOUR; h <= CLOSE_HOUR; h++) {
    const timeString = `${h.toString().padStart(2, '0')}:00`;
    const slotStart = new Date(year, month - 1, day, h, 0);
    const slotEnd = new Date(slotStart.getTime() + (SLOT_INTERVAL_MINUTES * 60000));

    // 過去の時間帯は選択できないようにする
    if (slotStart < now) {
      continue;
    }

    // もしすでにカレンダーに予定が入っていれば、その枠はスキップ（isConflict = true）
    let isConflict = false;
    for (const event of events) {
      const eventStart = event.getStartTime();
      const eventEnd = event.getEndTime();
      
      // 時間の重なりを判定
      // (新しい予定の開始時間が既存の終了時間より前) かつ (新しい予定の終了時間が既存の開始時間より後)
      if (slotStart < eventEnd && slotEnd > eventStart) {
        // [終日予定]の判定：終日予定の場合はブロックする(店休日の想定)
        if (event.isAllDayEvent()) {
           isConflict = true;
           break;
        }
        
        isConflict = true;
        break;
      }
    }

    // 予定が重なっていなければ、空き枠として追加
    if (!isConflict) {
      availableSlots.push(timeString);
    }
  }

  return availableSlots;
}

/**
 * JSON形式でクライアントにレスポンスを返すためのヘルパー関数
 */
function createJsonResponse(data, headers) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
