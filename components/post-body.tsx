import markdownStyles from "./markdown-styles.module.css";

interface Props {
  content: string;
}

const PostBody = ({ content }: Props): JSX.Element => {
  return (
    <div className="max-w-4xl mx-auto">
      <div
        className={markdownStyles.markdown}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  );
};

export default PostBody;
