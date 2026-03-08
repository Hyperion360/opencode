export const normalizeWorkspace = (directory: string) => {
  const drive = directory.match(/^([A-Za-z]:)[\\/]+$/)
  if (drive) return `${drive[1]}${directory.includes("\\") ? "\\" : "/"}`
  if (/^[\\/]+$/.test(directory)) return directory.includes("\\") ? "\\" : "/"
  const trimmed = directory.replace(/[\\/]+$/, "")
  if (trimmed === "/private/var") return "/var"
  return trimmed.replace(/^\/private\/var(?=\/)/, "/var")
}

export const sameWorkspace = (left: string, right: string) => normalizeWorkspace(left) === normalizeWorkspace(right)