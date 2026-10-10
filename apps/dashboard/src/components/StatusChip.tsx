import { statusChipClass, type CommentStatus } from "@perfect-front/design-tokens";
import { STATUS_LABEL } from "../lib/format";

export function StatusChip({ status }: { status: CommentStatus }) {
  return <span className={statusChipClass(status)}>{STATUS_LABEL[status]}</span>;
}
