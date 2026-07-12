import { useState } from "react";
import { useUser } from "@clerk/clerk-react";
import {
  useCreatePost,
  type CreatePostPayload,
  type PostKind,
} from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Props {
  /** Gallery category for this creation. */
  kind: PostKind;
  /** Lazily produce the serialized payload at submit time (null = nothing yet). */
  getPayload: () => CreatePostPayload | null;
  defaultName?: string;
  label?: string;
  /** Class for the trigger button so it blends into each editor's toolbar. */
  className?: string;
}

/**
 * Self-contained "Post to Gallery" trigger + modal. Requires a signed-in user
 * (falls back to a sign-in link). Publishes via the generated `useCreatePost`
 * hook; the Clerk token is attached by the api-client auth bridge.
 */
export function PostToGallery({
  kind,
  getPayload,
  defaultName = "",
  label = "Post",
  className = "ve-btn",
}: Props) {
  const { isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [isPublic, setIsPublic] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const create = useCreatePost();

  if (!isSignedIn) {
    return (
      <a className={className} href={`${basePath}/sign-in`}>
        Sign in to Post
      </a>
    );
  }

  const onOpen = () => {
    setErr(null);
    setDone(false);
    setName(defaultName);
    setIsPublic(true);
    setOpen(true);
  };

  const onSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Give your creation a name");
      return;
    }
    const payload = getPayload();
    if (!payload) {
      setErr("Nothing to post yet");
      return;
    }
    setErr(null);
    create.mutate(
      { data: { kind, name: trimmed.slice(0, 80), payload, isPublic } },
      {
        onSuccess: () => {
          setDone(true);
          setTimeout(() => setOpen(false), 900);
        },
        onError: (e) =>
          setErr(e instanceof Error ? e.message : "Failed to post"),
      },
    );
  };

  return (
    <>
      <button className={className} onClick={onOpen}>
        {label}
      </button>
      {open && (
        <div
          className="post-overlay"
          onClick={() => !create.isPending && setOpen(false)}
        >
          <div className="post-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Post to Gallery</h3>
            {done ? (
              <p className="post-ok">Posted! Find it in the Lobby.</p>
            ) : (
              <>
                <label className="post-field">
                  <span>Name</span>
                  <input
                    value={name}
                    maxLength={80}
                    autoFocus
                    placeholder="Name your creation"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSubmit();
                    }}
                  />
                </label>
                <label className="post-check">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                  />
                  Public — list it in the gallery
                </label>
                {err && <p className="post-err">{err}</p>}
                <div className="post-actions">
                  <button
                    className="ve-btn"
                    onClick={() => setOpen(false)}
                    disabled={create.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    className="ve-btn ve-play"
                    onClick={onSubmit}
                    disabled={create.isPending}
                  >
                    {create.isPending ? "Posting…" : "Post"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
