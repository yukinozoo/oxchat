/** 粗估 token：中日韩字符 1 个算 1 token，其余 4 个字符算 1 token。没有分词器时够用且稳定。 */
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g

export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  const cjk = text.match(CJK)?.length ?? 0
  return Math.ceil(cjk + (text.length - cjk) / 4)
}
