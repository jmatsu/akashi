import type { Catalog } from './en.ts'

/** The Japanese catalog. `Catalog` is what makes a missing or stray key a
 *  compile error rather than a string that quietly falls back to English. */
export const ja: Catalog = {
  // --- document head ----------------------------------------------------
  'app.title': 'Akashi — スクリーンショットと画面録画のための軽量ツール',
  'app.description':
    'スクリーンショットに注釈を入れ、画面録画を GIF に変換する軽量ツール。インストール不要、オフラインでも動作します。',
  'app.loading': '読み込み中…',

  // --- apps -------------------------------------------------------------
  'app.editor': '注釈',
  'app.gif': 'GIF',

  // --- web manifest -----------------------------------------------------
  'manifest.name': 'Akashi - スクリーンショットと画面録画のための軽量ツール',
  'manifest.description':
    'スクリーンショットにテキスト・図形・矢印・マーカー・絵文字スタンプ・モザイク / 黒塗りを入れ、画面録画をアニメーション GIF に変換できます。オフラインでも動作します。',

  // --- header -----------------------------------------------------------
  'action.open': '画像を開く',
  'action.blank': '新規',
  'action.undo': '元に戻す',
  'action.redo': 'やり直す',
  'action.clear': '全消去',
  'action.zoomOut': '縮小',
  'action.zoomIn': '拡大',
  'action.fit': '全体',
  'action.fitTitle': '全体表示',
  'action.copy': 'コピー',
  'action.copyTitle': 'クリップボードへコピー',
  'action.save': '保存',
  'action.saveTitle': 'PNG で保存',
  'action.draft': '下書き出力',
  'action.draftTitle': '別の端末に引き継ぐ',
  'action.delete': '削除',
  'name.label': '保存するファイルの名前',
  'name.placeholder': 'akashi-<日時>',
  'language.label': '言語',

  // --- header menus -----------------------------------------------------
  'menu.settings': '設定',
  'menu.file': 'ファイル',
  'menu.export': '書き出し',
  'menu.repo': 'ソースコード',
  'menu.build': 'ビルド {sha} · {date}',

  // --- install ----------------------------------------------------------
  'install.suggest': 'Akashi をインストールすると、オフラインでもすぐ開けます',
  'install.action': 'インストール',
  'install.menu': 'アプリとしてインストール',
  'install.dismiss': '閉じる',
  'install.manualTitle': 'ホーム画面に追加',
  'install.manualSteps': 'ブラウザバーの <kbd>共有</kbd> から <kbd>ホーム画面に追加</kbd> を選びます',
  'install.manualClose': 'わかりました',

  // --- app regions ------------------------------------------------------
  'region.apps': 'アプリ',
  'region.tools': 'ツール',
  'region.options': 'オプション',
  'region.gifOptions': '変換オプション',
  'stage.dropHint': '画像をドラッグ＆ドロップ、または <kbd>Ctrl/Cmd</kbd>+<kbd>V</kbd> で貼り付け',

  // --- tools ------------------------------------------------------------
  'tool.select': '選択',
  'tool.text': 'テキスト',
  'tool.rect': '四角',
  'tool.circle': '正円',
  'tool.ellipse': '楕円',
  'tool.arrow': '矢印',
  'tool.marker': 'マーカー',
  'tool.emoji': 'スタンプ',
  'tool.region': '範囲加工',

  // --- options bar ------------------------------------------------------
  'option.color': '色',
  'option.colorCustom': '任意の色',
  'option.fill': '塗り',
  'option.fillNone': 'なし',
  'option.outline': '縁取り',
  'option.outlineNone': 'なし',
  'option.outlineCustom': '任意の縁取り色',
  'option.fontSize': '文字サイズ',
  'option.strokeWidth': '線の太さ',
  'option.arrowWidth': '太さ',
  'option.markerWidth': '太さ',
  'option.emoji': 'スタンプ',
  'option.emojiSize': '大きさ',
  'option.arrowStyle': '種類',
  'option.regionMode': '加工',
  'option.regionStrength': '強弱',
  'arrow.line': '線',
  'arrow.solid': '実線',
  'arrow.double': '両端',
  'regionMode.mosaic': 'モザイク',
  'regionMode.blackout': '黒塗り',
  'regionMode.transparent': '透明化',
  'hint.canvas':
    'キャンバスをドラッグして移動、ピンチ / Ctrl+ホイールで拡大縮小。オブジェクトをクリックすると編集できます。',

  // --- gif converter ----------------------------------------------------
  'gif.open': '動画を開く',
  'gif.save': 'GIF を保存',
  'gif.saveTitle': '変換した GIF を保存',
  'gif.dropHint':
    '<kbd>webm</kbd> / <kbd>mov</kbd> / <kbd>mp4</kbd> をドラッグ＆ドロップ、またはヘッダーから開く',
  'gif.trim': '範囲',
  'gif.start': '開始',
  'gif.end': '終了',
  'gif.fps': 'フレームレート',
  'gif.width': '幅',
  'gif.widthOriginal': '元のまま',
  'gif.loop': 'ループ',
  'gif.dither': 'ディザ',
  'gif.ditherTitle': '色を混ぜて縞を目立たなくします。そのぶんファイルは大きくなります',
  'gif.convert': '変換',
  'gif.cancel': '中止',
  'gif.resultLabel': '変換した GIF',
  'gif.summary': '{count} フレーム · {width} × {height} · {fps} fps · 約 {size}',
  'gif.sampling': '色を選んでいます…',
  'gif.progress': 'フレーム {done} / {total}',
  'gif.result': '{width} × {height} · {count} フレーム · {size}',

  // --- messages ---------------------------------------------------------
  'confirm.discard': '編集中の内容が破棄されます。よろしいですか?',
  'toast.imageLoaded': '{width} × {height} を読み込みました',
  'toast.imageFailed': '画像を読み込めませんでした',
  'toast.saved': 'PNG を保存しました',
  'toast.copied': 'クリップボードにコピーしました',
  'toast.copyUnsupported': 'このブラウザではコピーできません。PNG 保存を使ってください',
  'toast.draftLoaded': '下書きを開きました（注釈 {count} 個）',
  'toast.draftSaved': '下書きを保存しました。別の端末で開くと続きから編集できます',
  'toast.videoLoaded': '{width} × {height}、{duration} を読み込みました',
  'toast.videoFailed': 'このブラウザではその動画を開けません',
  'toast.gifSaved': 'GIF を保存しました',
  'toast.gifFailed': 'この動画は変換できませんでした',
  'toast.installed': 'インストールしました。単独のアプリとして開けます',
}
