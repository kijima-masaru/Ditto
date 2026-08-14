import { app, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { execFile } from 'child_process'
import { writeFile, readFile, unlink } from 'fs/promises'
import path from 'path'
import log from './logger'
import * as settingsStore from './settingsStore'

/**
 * スクリーンショット・失敗時エビデンス画像を保存する前に、電話番号やメールアドレスなど
 * 個人情報・機密情報らしき文字列が写り込んでいれば自動で黒塗りする機能。
 * 設定でON/OFFを切り替えられ、OFFの場合や検出に失敗した場合は元の画像をそのまま返す
 * (この機能自体が保存処理を止めてしまわないようにするため)。
 *
 * OCRは追加の重いライブラリやモデルファイルを同梱せずに済むよう、Windowsに標準で
 * 入っているOCRエンジン(Windows.Media.Ocr)をPowerShell経由で呼び出す方式にしている。
 */

interface OcrWord {
  text: string
  x: number
  y: number
  width: number
  height: number
}

interface OcrLine {
  text: string
  words: OcrWord[]
}

// 電話番号・郵便番号・メールアドレス・クレジットカード/マイナンバー(12桁)らしき文字列を検出する。
// OCRは単語単位(空白区切り)で認識されることが多いため、単語全体の完全一致ではなく
// 部分一致で判定する(「TEL:090-1234-5678」のように前置きが付いた1単語になる場合もあるため)
const PII_PATTERNS: RegExp[] = [
  /0\d{1,4}-?\d{1,4}-?\d{3,4}/, // 電話番号
  /\b\d{3}-\d{4}\b/, // 郵便番号(ハイフン必須。単なる4桁数字等の誤検出を避けるため)
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // メールアドレス
  /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/ // クレジットカード番号/マイナンバー(12〜16桁)
]

// OCRは数字やハイフンの並びを1文字ずつ別単語として認識することが多く(実機検証で確認済み)、
// 単語単体では「090-1234-5678」のような並びにマッチしない。そのため行(Line)単位でテキストを
// 連結してからPIIパターンを判定する。空白除去版でも判定することで、OCRが単語間に余分な
// 空白を挟んだ場合(「0 9 0 -1234-5678」等)も拾えるようにする。
function looksLikePii(lineText: string): boolean {
  const trimmed = lineText.trim()
  if (trimmed.length < 4) return false
  if (PII_PATTERNS.some((re) => re.test(trimmed))) return true
  const noSpace = trimmed.replace(/\s+/g, '')
  return PII_PATTERNS.some((re) => re.test(noSpace))
}

// PowerShellからWindows RuntimeのOCR APIを呼び出し、認識できた行テキストと各単語の画像内座標をJSONで返す。
// $args[0]に画像ファイルパス、$args[1]に結果JSONの出力先パスを渡す。
// 標準出力経由で日本語を返すとPowerShellのコンソール出力コードページ(システムのANSI/OEM)で
// 再エンコードされ文字化けするため、UTF-8を明示してファイルへ書き出す方式にしている。
const OCR_SCRIPT = `
$ErrorActionPreference = 'Stop'
$imagePath = $args[0]
$outPath = $args[1]
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]
  function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }
  [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
  [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime] | Out-Null

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $engine = $null
  try { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('ja')) } catch {}
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $engine) { [System.IO.File]::WriteAllText($outPath, '[]', (New-Object System.Text.UTF8Encoding($false))); exit 0 }

  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = New-Object System.Collections.Generic.List[object]
  foreach ($line in $result.Lines) {
    $words = New-Object System.Collections.Generic.List[object]
    foreach ($word in $line.Words) {
      $rect = $word.BoundingRect
      $words.Add([PSCustomObject]@{
        x = [math]::Round($rect.X, 0)
        y = [math]::Round($rect.Y, 0)
        width = [math]::Round($rect.Width, 0)
        height = [math]::Round($rect.Height, 0)
      })
    }
    $lines.Add([PSCustomObject]@{
      text = $line.Text
      words = $words
    })
  }
  $json = $lines | ConvertTo-Json -Compress -Depth 5
  if (-not $json) { $json = '[]' }
  [System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))
} catch {
  [System.IO.File]::WriteAllText($outPath, '[]', (New-Object System.Text.UTF8Encoding($false)))
}
`

// -Commandに続けて画像パス等を渡すとPowerShell 5.1側の$args束縛が不安定になり
// (実機検証でパス引数が空扱いになる不具合を確認済み)、スクリプト本体を毎回一時.ps1ファイルに
// 書き出し-Fileで実行する方式にしている。こちらは$argsへの束縛が確実に安定する。
async function runOcr(imagePath: string): Promise<OcrLine[]> {
  const scriptPath = path.join(app.getPath('temp'), `ditto-ocr-script-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
  const outPath = path.join(app.getPath('temp'), `ditto-ocr-out-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  try {
    await writeFile(scriptPath, OCR_SCRIPT, 'utf8')
    await new Promise<void>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, imagePath, outPath],
        { maxBuffer: 20 * 1024 * 1024, timeout: 15000 },
        (err) => {
          if (err) log.warn('piiMask OCR failed', err)
          resolve()
        }
      )
    })
    const raw = await readFile(outPath, 'utf8')
    const trimmed = raw.trim()
    if (!trimmed) return []
    const parsed = JSON.parse(trimmed) as OcrLine | OcrLine[]
    const lines = Array.isArray(parsed) ? parsed : [parsed]
    // PowerShellの単一要素配列はConvertTo-Jsonでオブジェクト直書きになる場合があるため、
    // wordsが単一オブジェクトになっているケースも配列に正規化する
    return lines.map((l) => ({ text: l.text ?? '', words: Array.isArray(l.words) ? l.words : l.words ? [l.words] : [] }))
  } catch (err) {
    log.warn('piiMask OCR output read/parse failed', err)
    return []
  } finally {
    unlink(outPath).catch(() => {})
    unlink(scriptPath).catch(() => {})
  }
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// 行内の各単語のバウンディングボックスを1つに統合した矩形を返す。
// 単語単位でなく行単位で塗る(該当行の一部だけが機密情報でも行全体を塗る)ことで、
// 数字・記号がOCR上1文字ずつ別単語に分割されるケースでも塗り漏れが出ないようにする。
function unionRect(words: OcrWord[]): Rect | null {
  if (words.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const w of words) {
    x0 = Math.min(x0, w.x)
    y0 = Math.min(y0, w.y)
    x1 = Math.max(x1, w.x + w.width)
    y1 = Math.max(y1, w.y + w.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function blackOutRegions(image: NativeImage, regions: Rect[]): NativeImage {
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  // 枠ぴったりだと文字がわずかにはみ出て残ることがあるため、少し余白を持たせて塗る
  const MARGIN = 4
  for (const r of regions) {
    const x0 = Math.max(0, Math.floor(r.x - MARGIN))
    const y0 = Math.max(0, Math.floor(r.y - MARGIN))
    const x1 = Math.min(width, Math.ceil(r.x + r.width + MARGIN))
    const y1 = Math.min(height, Math.ceil(r.y + r.height + MARGIN))
    for (let y = y0; y < y1; y++) {
      const rowStart = (y * width + x0) * 4
      const rowLen = (x1 - x0) * 4
      bitmap.fill(0, rowStart, rowStart + rowLen)
      // アルファチャンネルは不透明(255)のままにする(fillで0にしてしまった分を戻す)
      for (let x = x0; x < x1; x++) {
        bitmap[(y * width + x) * 4 + 3] = 255
      }
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height })
}

async function isEnabled(): Promise<boolean> {
  try {
    const settings = await settingsStore.getSettings()
    return settings.autoMaskSensitiveInfo
  } catch {
    return false
  }
}

async function detectAndMask(image: NativeImage): Promise<NativeImage> {
  const tmpPath = path.join(app.getPath('temp'), `ditto-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  try {
    await writeFile(tmpPath, image.toPNG())
    const lines = await runOcr(tmpPath)
    const piiRegions = lines
      .filter((l) => looksLikePii(l.text))
      .map((l) => unionRect(l.words))
      .filter((r): r is Rect => r !== null)
    if (piiRegions.length === 0) return image
    return blackOutRegions(image, piiRegions)
  } catch (err) {
    log.warn('piiMask detectAndMask failed', err)
    return image
  } finally {
    unlink(tmpPath).catch(() => {})
  }
}

/** 設定がONの場合のみ、PNGバイト列を検査してマスキング済みのPNGバイト列を返す */
export async function maskPngIfEnabled(png: Buffer): Promise<Buffer> {
  if (!(await isEnabled())) return png
  try {
    const image = nativeImage.createFromBuffer(png)
    const masked = await detectAndMask(image)
    return masked.toPNG()
  } catch (err) {
    log.warn('maskPngIfEnabled failed, using original image', err)
    return png
  }
}

/** 設定がONの場合のみ、data URL(PNG)を検査してマスキング済みのdata URLを返す */
export async function maskDataUrlIfEnabled(dataUrl: string): Promise<string> {
  if (!(await isEnabled())) return dataUrl
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    const masked = await detectAndMask(image)
    return masked.toDataURL()
  } catch (err) {
    log.warn('maskDataUrlIfEnabled failed, using original image', err)
    return dataUrl
  }
}
