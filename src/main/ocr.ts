import { app } from 'electron'
import type { NativeImage } from 'electron'
import { execFile } from 'child_process'
import { writeFile, readFile, unlink } from 'fs/promises'
import path from 'path'
import log from './logger'

/**
 * Windowsに標準で入っているOCRエンジン(Windows.Media.Ocr)をPowerShell経由で呼び出す共通処理。
 * 機密情報自動マスキング(piiMask.ts)とクリップボード画像のOCRテキスト検索の両方から使う。
 */

export interface OcrWord {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface OcrLine {
  text: string
  words: OcrWord[]
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
        text = $word.Text
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

/**
 * Windows OCR(Windows.Media.Ocr)の`OcrLine.Text`は、単語(Words)をASCIIの半角スペース区切りで
 * 連結しただけの値になる。英語のような分かち書き言語ではこれで自然な文になるが、日本語は
 * 文字単位・短い文字列単位で「単語」として区切られることが多く、そのまま使うと
 * 「ご 利 用 者 各 位」のように文字ごとに不自然な空白が入ってしまう。
 * そこで単語のバウンディングボックス(画像内の隙間)を見て、隙間が文字の高さに対して
 * 十分小さい場合はスペースを入れずに連結し、実際に離れている場合のみスペースを入れる。
 * 日本語の文字送りはもちろん、電話番号やメールアドレスのように本来ひと続きの英数字列が
 * 複数の単語に分割された場合も、隙間がほぼ0になるためこの判定で正しく連結される。
 */
function joinWordsAsLineText(words: OcrWord[]): string {
  if (words.length === 0) return ''
  let result = words[0].text ?? ''
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]
    const curr = words[i]
    const gap = curr.x - (prev.x + prev.width)
    const threshold = Math.max(prev.height, curr.height) * 0.4
    result += (gap > threshold ? ' ' : '') + (curr.text ?? '')
  }
  return result
}

// -Commandに続けて画像パス等を渡すとPowerShell 5.1側の$args束縛が不安定になり
// (実機検証でパス引数が空扱いになる不具合を確認済み)、スクリプト本体を毎回一時.ps1ファイルに
// 書き出し-Fileで実行する方式にしている。こちらは$argsへの束縛が確実に安定する。
async function runOcrOnPath(imagePath: string): Promise<OcrLine[]> {
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
          if (err) log.warn('ocr runOcrOnPath failed', err)
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
    return lines.map((l) => {
      const words = Array.isArray(l.words) ? l.words : l.words ? [l.words] : []
      return { text: joinWordsAsLineText(words), words }
    })
  } catch (err) {
    log.warn('ocr runOcrOnPath output read/parse failed', err)
    return []
  } finally {
    unlink(outPath).catch(() => {})
    unlink(scriptPath).catch(() => {})
  }
}

/** NativeImageを一時PNGファイルに書き出してOCRし、認識結果を行単位で返す(失敗時は空配列) */
export async function runOcrOnImage(image: NativeImage): Promise<OcrLine[]> {
  const tmpPath = path.join(app.getPath('temp'), `ditto-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  try {
    await writeFile(tmpPath, image.toPNG())
    return await runOcrOnPath(tmpPath)
  } catch (err) {
    log.warn('ocr runOcrOnImage failed', err)
    return []
  } finally {
    unlink(tmpPath).catch(() => {})
  }
}
