# Public website copy audit — 6 November 2026

Implemented the approved homepage statement:

> Fikr helps you capture ideas, connect knowledge, work with AI, and bring stories to life.

Reviewed the public homepage, product pages, Vox documentation, navigation, calls to action, pricing explanations, metadata, and shared footer. Legal pages retain their existing policy language.

| Product | Hero communicates | Supporting copy explains |
| --- | --- | --- |
| Go | Turn your voice into clear notes. | Record thoughts on a phone and use AI to turn them into useful notes. |
| Studio | Connect your notes. Develop your ideas. | A desktop workspace for notes and projects, with AI to find connections and build context. |
| Cowork | Work with AI apps. Keep the context. | Run AI-powered apps in a visual workspace, review results, and continue with their context. |
| Vox | Voiceovers. Podcasts. Your voice. | An open-source Mac app for voiceovers, multi-speaker podcasts, and video dubbing, with local, cloned, and connected cloud voices. |

Product cards and supporting sections now reinforce these functions. Replaced “agentic apps” with “AI-powered apps” in marketing copy. Go's final call to action links to its iPhone and Android store listings. Studio points to plans; Cowork points to account creation. Vox states the current Mac/Apple silicon and build-from-source availability, MIT license, and separate provider costs. Removed two remaining MyTwin labels from the Vox source and documentation sections.

Preserved the story narratives and abstract full-bleed backgrounds. No pricing amounts, legal terms, authentication, or billing behavior changed.

Validation: checked all four product heroes, homepage, and Vox docs in the browser; no horizontal overflow at mobile width 390. Existing routing checks pass (2 tests), including preservation of authenticated upstream requests. These checks do not exercise signed-in billing or account creation.
