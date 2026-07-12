import { FeedbackState } from "@/components/states/feedback-state";

export default function NotFound() {
  return (
    <FeedbackState
      kind="notFound"
      title="页面不存在"
      description="该地址可能已经改变，或者内容尚未发布。"
    />
  );
}
