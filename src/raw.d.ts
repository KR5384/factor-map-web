/** Vite の `?raw` 取り込み (ファイル内容を文字列として読む) の型宣言。 */
declare module "*?raw" {
  const content: string;
  export default content;
}
