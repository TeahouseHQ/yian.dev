import type { ReactNode } from "react";

import markdownStyles from "../styles/markdown-styles.module.css";

interface Props {
  content: ReactNode;
}

const PostBody = ({ content }: Props): React.JSX.Element => {
  return (
    <div className="max-w-4xl mx-auto">
      <div className={markdownStyles.markdown}>{content}</div>
    </div>
  );
};

export default PostBody;
