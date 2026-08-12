/** テスト一覧・定型文で共通の階層フォルダ(id/name/parentIdの形)を扱うための純粋な補助関数 */
export interface FolderLike {
  id: string
  name: string
  parentId: string | null
}

export function flattenFolders<T extends FolderLike>(folders: T[]): { folder: T; depth: number }[] {
  const result: { folder: T; depth: number }[] = []
  const addChildren = (parentId: string | null, depth: number): void => {
    for (const f of folders.filter((x) => x.parentId === parentId)) {
      result.push({ folder: f, depth })
      addChildren(f.id, depth + 1)
    }
  }
  addChildren(null, 0)
  return result
}

export function folderBreadcrumb<T extends FolderLike>(folders: T[], currentId: string | null): T[] {
  const breadcrumb: T[] = []
  let cursor = currentId
  while (cursor) {
    const f = folders.find((x) => x.id === cursor)
    if (!f) break
    breadcrumb.unshift(f)
    cursor = f.parentId
  }
  return breadcrumb
}
