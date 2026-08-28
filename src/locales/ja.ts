import type { Catalog } from './en.ts'

/** The Japanese catalog. `Catalog` is what makes a missing or stray key a
 *  compile error rather than a string that quietly falls back to English. */
export const ja: Catalog = {
  // --- document head ----------------------------------------------------
  'app.title': 'aka — 軽量アノテーションツール',
  'app.description':
    'スクリーンショットに注釈・モザイク・黒塗りを入れる軽量ツール。インストール不要、オフラインでも動作します。',
  'app.loading': '読み込み中…',

  // --- web manifest -----------------------------------------------------
  'manifest.name': 'aka - 軽量アノテーションツール',
  'manifest.description':
    'スクリーンショットにテキスト・図形・矢印・マーカー・絵文字スタンプ・モザイク / 黒塗りを入れられます。オフラインでも動作します。',

  // --- header -----------------------------------------------------------
  'action.open': '画像を開く',
  'action.blank': '白紙',
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
  'action.draft': '下書き',
  'action.draftTitle': '編集中のまま別の端末へ渡す',
  'action.delete': '削除',
  'language.label': '言語',

  // --- app regions ------------------------------------------------------
  'region.tools': 'ツール',
  'region.options': 'オプション',
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
  'option.fontSize': '文字サイズ',
  'option.strokeWidth': '線の太さ',
  'option.arrowWidth': '太さ',
  'option.markerWidth': '太さ',
  'option.emoji': 'スタンプ',
  'option.emojiSize': '大きさ',
  'option.arrowStyle': '種類',
  'option.regionMode': '加工',
  'option.regionStrength': '強さ',
  'arrow.line': '線',
  'arrow.solid': '実線',
  'arrow.double': '両端',
  'regionMode.mosaic': 'モザイク',
  'regionMode.blackout': '黒塗り',
  'regionMode.transparent': '透明化',
  'hint.canvas':
    'キャンバスをドラッグして移動、ピンチ / Ctrl+ホイールで拡大縮小。オブジェクトをクリックすると編集できます。',

  // --- messages ---------------------------------------------------------
  'confirm.discard': '編集中の内容が破棄されます。よろしいですか?',
  'toast.imageLoaded': '{width} × {height} を読み込みました',
  'toast.imageFailed': '画像を読み込めませんでした',
  'toast.saved': 'PNG を保存しました',
  'toast.copied': 'クリップボードにコピーしました',
  'toast.copyUnsupported': 'このブラウザではコピーできません。PNG 保存を使ってください',
  'toast.draftLoaded': '下書きを開きました（注釈 {count} 個）',
  'toast.draftSaved': '下書きを保存しました。別の端末で開くと続きから編集できます',
}
