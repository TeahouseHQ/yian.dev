"use client";
import { useEffect } from "react";

type Props = {
  pageUrl: string;
  pageId: string;
  enabled?: boolean;
};

const CommentsBox = (props: Props): React.JSX.Element => {
  const { pageUrl, pageId, enabled } = props;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (window.DISQUS) {
      window.DISQUS.reset({
        reload: true,
        config: function (this: { page: { identifier: string; url: string } }) {
          this.page.identifier = pageId;
          this.page.url = pageUrl;
        },
      });
    } else {
      window.disqus_config = function (this: { page: { identifier: string; url: string } }) {
        this.page.url = pageUrl;
        this.page.identifier = pageId;
      };
      (function () {
        var d = document,
          s = d.createElement("script");
        s.src = "https://pedalpowereddev.disqus.com/embed.js";
        s.setAttribute("data-timestamp", new Date().toString());
        (d.head || d.body).appendChild(s);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-4xl mx-auto mb-32">
      <div id="disqus_thread" />
      <noscript>
        Please enable JavaScript to view the{" "}
        <a href="https://disqus.com/?ref_noscript">comments powered by Disqus.</a>
      </noscript>
    </div>
  );
};

export default CommentsBox;
