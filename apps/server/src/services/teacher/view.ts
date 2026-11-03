// teacher DTO 投影：只输出 OpenAPI 列出的字段，禁止把数据库行直接 JSON.stringify 出去（06 §2 的白名单思路）。
// 教师 DTO 与学生会话无关，但同样不能回显 user_id、密文、学号哈希等内部字段。

export type ClassSummaryRow = {
  class_id: string;
  name: string;
  term: string;
  invite_code: string;
  settings: unknown;
  students: number | string;
  claimed: number | string;
}

export function toClassSummary(row: ClassSummaryRow): Record<string, unknown> {
  return {
    classId: row.class_id,
    name: row.name,
    term: row.term,
    inviteCode: row.invite_code,
    students: Number(row.students),
    claimed: Number(row.claimed),
    settings: row.settings ?? {},
  };
}

export type AssignmentCardRow = {
  id: string;
  public: unknown;
  mode: string;
  status: string;
  open_at: Date | string;
  close_at: Date | string | null;
  review_published_at: Date | string | null;
}

type PublicProblemShape = {
  title?: string;
  stem?: string;
  chapter?: string;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function toAssignmentCard(row: AssignmentCardRow): Record<string, unknown> {
  const pub = (row.public ?? {}) as PublicProblemShape;
  return {
    assignmentId: row.id,
    title: pub.title ?? '未命名题目',
    chapter: pub.chapter,
    stem: pub.stem,
    mode: row.mode,
    status: row.status,
    openAt: iso(row.open_at),
    closeAt: row.close_at === null ? null : iso(row.close_at),
    reviewPublished: row.review_published_at !== null,
  };
}
