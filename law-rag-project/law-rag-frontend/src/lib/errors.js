// Turns axios errors into short plain-language messages. The server's own
// (often technical) message is kept in `technical` for a "자세히" toggle.
export function describeError(error, context = "request") {
  if (error?.code === "ERR_CANCELED") {
    return { kind: "canceled", title: "요청이 취소되었습니다", detail: "" };
  }

  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
    return {
      kind: "timeout",
      title: "응답이 지연되고 있습니다",
      detail: context === "index" ? "잠시 후 문서 목록을 새로고침해 보세요." : "",
    };
  }

  if (!error?.response) {
    return { kind: "network", title: "서버에 연결할 수 없습니다", detail: "" };
  }

  const { status, data } = error.response;
  const technical =
    typeof data?.detail === "string"
      ? data.detail
      : Array.isArray(data?.detail)
        ? data.detail.map((item) => item.msg).join(", ")
        : error.message;

  const messages = {
    index:
      status === 400
        ? ["PDF 파일만 올릴 수 있습니다", ""]
        : ["문서를 준비하지 못했습니다", "스캔 이미지로 된 PDF는 읽을 수 없습니다."],
    ask: ["답변을 만들지 못했습니다", ""],
    delete: ["삭제하지 못했습니다", ""],
    reset: status === 403 ? ["관리자 비밀번호가 맞지 않습니다", ""] : ["지우지 못했습니다", ""],
    list: ["문서 목록을 불러오지 못했습니다", ""],
  };

  const [title, detail] = messages[context] ?? ["요청을 처리하지 못했습니다", ""];
  return { kind: "server", status, title, detail, technical };
}
