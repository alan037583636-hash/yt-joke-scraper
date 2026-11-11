import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { fetchTranscript } from "youtube-transcript";

const CHANNEL_ID = "UC0lbAQVpenvfA2QqzsRtL_g";
// 修正 1：改為正確存在的模型名稱
const GEMINI_MODEL = "gemini-3.5-flash-lite";
const MAX_GEMINI_RETRIES = 3;
const GEMINI_RETRY_DELAY_MS = 2000;
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY is missing. Add it to your .env file or GitHub Actions secrets.");
}

function formatTime(offset, offsetInMilliseconds = false) {
  const totalSeconds = Math.floor(offsetInMilliseconds ? offset / 1000 : offset);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// 修正 2：改為回傳「前 3 支」符合條件的影片 ID 陣列，作為備用
async function getLatestVideoIds(channelId) {
  const feedUrl = new URL("https://www.youtube.com/feeds/videos.xml");
  feedUrl.searchParams.set("channel_id", channelId);

  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error(`YouTube RSS request failed (${response.status} ${response.statusText}).`);
  }

  const feedXml = await response.text();
  const entries = feedXml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g);
  
  const videoIds = [];
  for (const [, entryXml] of entries) {
    const title = entryXml.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/)?.[1];
    const videoId = entryXml.match(/<yt:videoId(?:\s[^>]*)?>([\s\S]*?)<\/yt:videoId>/)?.[1];

    if (title?.includes("早晨財經") && videoId) {
      videoIds.push(videoId.trim());
    }
  }

  if (videoIds.length === 0) {
    throw new Error(`找不到包含「早晨財經」的近期影片。`);
  }
  return videoIds.slice(0, 3); // 回傳最新的 3 支
}

async function getVideoTranscript(videoId) {
  // 這裡你修好無窮迴圈了，很棒！
  const transcript = await fetchTranscript(videoId);
  const offsetInMilliseconds =
    transcript.length > 0 &&
    transcript.reduce((total, entry) => total + entry.duration, 0) / transcript.length > 100;

  return transcript.map(({ text, offset }) => `[${formatTime(offset, offsetInMilliseconds)}] ${text}`);
}

async function findJoke(transcriptLines) {
  const fullText = transcriptLines.join("\n");
  const prompt = `# 角色
你是《游庭皓的財經皓角》（早晨財經速解讀）逐字稿的資料萃取專家。請從提供的當日逐字稿中，優先找出游庭皓本人實際講出的黃色笑話、成人雙關或帶有性暗示的幽默段子；若不足兩則，再補充其他明確的笑話、冷笑話、諧音梗或自嘲。

# 判定原則
只有在逐字稿中有足夠證據顯示內容具有幽默意圖或笑點時，才列為笑話。優先辨識以性暗示、成人情境或曖昧詞語形成的雙關、諧音、反轉或笑點；尺度可以含蓄，但必須有逐字稿內容作為依據。不能只因出現單一敏感詞或成人話題就判定為黃色笑話。
- 也可辨識其他具有鋪陳與反轉、雙關、諧音、出乎意料收尾或明確笑點的內容，但排序低於符合條件的黃色笑話。
- 主持人明確表示要講笑話、段子或冷笑話，且後續確實講出完整內容。
- 主持人講述自嘲或生活趣事，內容本身有明確的幽默效果。

常見引導語包括「跟大家分享一個笑話」、「最近看到一個段子」、「說個題外話」、「網路上看到一段話」、「今天講個冷笑話」、「有一句話是這樣說的」等。這些只是線索，不是笑話成立的充分條件。

# 來源與排除規則
1. 只擷取游庭皓本人講述或轉述的笑話。若內容明確是聽眾留言、斗內文字、新聞引述、網路貼文或他人說法，不要直接算作主持人的笑話；只有在主持人進一步加工、補充或講成完整段子時，才擷取主持人講出的幽默部分。
2. 排除一般比喻、反諷、犀利評論、口頭禪、誇張說法，以及雖然有趣但沒有明確笑點的內容。
3. 排除財經新聞、數據解讀、投資建議、一般生活分享與業配內容。業配前後若有獨立且完整的笑話，只擷取該笑話。
4. 不要只根據「哈哈」、「開個玩笑」、「回到正題」等語氣或轉折詞判定有笑話；必須有實際的笑話內容。
5. 若笑話鋪陳與笑點分散在相鄰字幕，且可清楚確認屬於同一個段子，應合併擷取。不要把無關內容拼接成笑話。
6. 若內容被截斷、缺少關鍵笑點，或無法確認是主持人講述或加工的內容，不要猜測或補寫。

# 擷取方式
- 保留笑話原本的鋪陳、必要背景與笑點，讓讀者看得懂。
- 可刪除不影響語意的口語贅字，例如「呃」、「啊」、「那個」；不可改寫、補充或自行創作原文沒有的笑點。
- 保持原意與原本語氣，適度整理標點及分句。
- 最多列出兩則獨立笑話，優先選擇最明確、最完整的黃色笑話；若黃色笑話不足兩則，可用其他明確笑話補足。若只有一則符合條件，就只列一則；不可為了湊滿兩則而列入不確定內容。
- 同一個笑話不要拆成多筆。若有多於兩則符合條件，優先保留黃色笑話，再依笑點明確度與內容完整度排序。

# 輸出格式
只輸出合法 JSON，不要附加 Markdown、說明文字或其他內容。必須使用以下欄位：
{"has_joke": true, "jokes": [{"timestamp": "逐字稿中的時間戳", "joke_text": "整理後的笑話全文", "explanation": "簡短說明笑點"}]}

timestamp 必須抄錄該笑話開始處逐字稿方括號中的時間戳，不要自行推算或改寫。explanation 只描述逐字稿中明確呈現的笑點；若無法可靠解釋，不要列入該筆。
有笑話時，jokes 最多包含兩則，並依上述優先順序排列；沒有符合條件的笑話時，嚴格回傳 {"has_joke": false, "jokes": []}。

# 最終檢查
輸出前逐一確認：內容是否真的有笑點，而不只是提到成人話題、有趣、諷刺或語氣輕鬆；黃色笑話是否有逐字稿依據，而非自行推測；是否有根據逐字稿確認為主持人講述或加工；是否保留理解笑點所需的鋪陳與笑點；時間戳是否逐字抄錄；jokes 是否不超過兩則。只要無法確認，就不要列入 jokes。

逐字稿如下：
${fullText}`;

  let response;
  let responseBody;

  for (let attempt = 0; attempt <= MAX_GEMINI_RETRIES; attempt += 1) {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    responseBody = await response.text();

    if (response.ok) {
      break;
    }

    const errorMessage = `Gemini API request failed (${response.status} ${response.statusText}): ${responseBody}`;
    if (response.status !== 503 || attempt === MAX_GEMINI_RETRIES) {
      throw new Error(errorMessage);
    }

    const delayMs = GEMINI_RETRY_DELAY_MS * 2 ** attempt;
    console.warn(
      `${errorMessage} Retrying in ${delayMs}ms (retry ${attempt + 1}/${MAX_GEMINI_RETRIES}).`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const result = JSON.parse(responseBody);
  const responseText = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (typeof responseText !== "string") {
    throw new Error("Gemini API response did not contain a message.");
  }

  return JSON.stringify(JSON.parse(responseText), null, 2);
}

// ================= 主程式執行區塊 =================
console.log("🤖 [系統啟動] 開始尋找今天的財經皓角笑話...");
const taiwanTime = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "full", timeStyle: "long" }).format(new Date());
console.log(`目前台灣時間：${taiwanTime}`);

(async () => {
  try {
    const latestVideoIds = await getLatestVideoIds(CHANNEL_ID);
    console.log(`🔍 找到最新影片清單: [${latestVideoIds.join(", ")}]`);

    let formattedTranscript = null;
    let successfulVideoId = null;

    // 迴圈容錯：嘗試陣列中的影片，只要有一支成功抓到字幕就跳出迴圈
    for (const videoId of latestVideoIds) {
      try {
        console.log(`⏳ 嘗試抓取影片 ${videoId} 的字幕...`);
        formattedTranscript = await getVideoTranscript(videoId);
        successfulVideoId = videoId;
        console.log(`✅ 成功抓取影片 ${videoId} 的字幕！共 ${formattedTranscript.length} 句。`);
        break;
      } catch (err) {
        console.log(`⚠️ 影片 ${videoId} 抓取字幕失敗 (${err.message})，嘗試下一支...`);
      }
    }

    if (!formattedTranscript) {
      console.log('🚨 備用影片皆無字幕或抓取失敗，今日任務提早結束。');
      process.exit(0);
    }

    console.log(formattedTranscript.slice(0, 5).join("\n") + "\n...");

    const jokeAnalysis = JSON.parse(await findJoke(formattedTranscript));
    
    // 取得台灣時間的 YYYY-MM-DD
    const dateParts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const fetchDate = `${dateParts.find(({ type }) => type === "year").value}-${dateParts.find(({ type }) => type === "month").value}-${dateParts.find(({ type }) => type === "day").value}`;
    
    // 將成功的 Video ID 一併存入 JSON，方便前端直接做 iframe 嵌入跳轉！
    const result = { ...jokeAnalysis, video_id: successfulVideoId, fetch_date: fetchDate };

    await writeFile("latest_joke.json", `${JSON.stringify(result, null, 2)}\n`);
    console.log("🎉 AI 分析結果已儲存至 latest_joke.json：");
    console.log(JSON.stringify(result, null, 2));

  } catch (error) {
    console.error("❌ 笑話擷取流程失敗：", error);
    process.exitCode = 1;
  }
})();