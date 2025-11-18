import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import WorldExplorer from "../islands/WorldExplorer.tsx";

export default define.page(function Home() {
  return (
    <>
      <Head>
        <title>World Explorer - Text Adventure</title>
        <meta
          name="description"
          content="A text-based adventure game powered by AI"
        />
      </Head>
      <WorldExplorer />
    </>
  );
});
