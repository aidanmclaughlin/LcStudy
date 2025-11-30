# LcStudy Complete Codebase Refactor Plan

## Overview

This plan covers a comprehensive refactoring of the LcStudy codebase focused on **code readability and cleanliness** without changing UI or core logic.

---

## 1. main.js Decomposition (Priority: Critical)

The 1,394-line `public/legacy/js/main.js` is the primary refactor target. Split into focused modules:

### New Module Structure

```
public/legacy/js/
├── main.js                 # Entry point - bootstrap and event binding only
├── modules/
│   ├── state.js           # Game state management (sessionCache, game variables)
│   ├── board.js           # Board rendering, FEN parsing, piece placement
│   ├── moves.js           # Move validation, submission, round management
│   ├── charts.js          # Chart.js initialization and updates
│   ├── audio.js           # Sound effects, AudioContext management
│   ├── effects.js         # Visual effects (confetti, shimmer, flash)
│   ├── api.js             # All fetch calls to backend
│   ├── history.js         # Move history and navigation
│   └── constants.js       # All constants and configuration
```

### Specific Changes

**state.js** - Extract all state variables:
- `sessionCache`, `SID`, `currentFen`, `boardIsFlipped`
- `gameAttempts`, `totalAttempts`, `currentMoveAttempts`
- `moveHistory`, `currentMoveIndex`, `isReviewingMoves`
- Export getter/setter functions for controlled access

**board.js** - Board rendering logic:
- `initBoard()`, `createBoardHTML()`, `updateBoardFromFen()`
- `parseFEN()`, `setBoardFlip()`, `onSquareClick()`
- `clearSelection()`, `animateMove()`

**moves.js** - Move handling:
- `submitMove()`, `completeExpectedMove()`
- `applyMoveToBoard()`, `handleMaiaReply()`
- `buildRoundsFromMoves()`, `getExpectedPlayerMove()`
- Round index management functions

**charts.js** - Chart management:
- `initializeCharts()`, `updateCharts()`
- Chart configuration objects
- `updateStatistics()`, `updateAttemptsRemaining()`

**audio.js** - Sound system:
- `getAudioContext()`, `unlockAudio()`
- `playSuccessChime()`, `vibrateSuccess()`

**effects.js** - Visual feedback:
- `flashBoard()`, `createConfetti()`, `createConfettiBurstAt()`
- `successPulseAtSquare()`, `shimmerJackpotOnBoard()`
- `celebrateSuccess()`, `showStreakPill()`

**api.js** - Backend communication:
- `loadGameHistory()`, `saveCompletedGame()`
- `fetchNewSession()` (extracted from `start()`)

**history.js** - Move navigation:
- `addMoveToHistory()`, `resetMoveHistory()`
- `navigateToMove()`, `updateNavigationUI()`
- `handleKeyPress()`

**constants.js** - Configuration:
- `ATTEMPT_LIMIT`, `CHART_JS_SRC`, `CHESS_JS_SRC`
- `defaultPieceImages`, `pieceCodes`
- Chart color schemes

---

## 2. CSS Consolidation (Priority: High)

### Current State
- `globals.css` (456 lines) - Layout, responsive, auth styles
- `main.css` (326 lines) - Board, animations, UI components

### Target Structure

```
app/
├── globals.css            # Base styles, CSS variables, typography
├── styles/
│   ├── layout.css        # Grid layout, responsive breakpoints
│   ├── board.css         # Board, squares, pieces, animations
│   ├── panels.css        # Sidebar panels, charts, history
│   ├── buttons.css       # Buttons, pills, interactive elements
│   └── auth.css          # Auth modal, avatar, chips
```

### Specific Changes

1. **Consolidate CSS Variables** - Single source of truth in `:root`
   - Merge variables from both files
   - Consistent naming: `--color-*`, `--spacing-*`, `--radius-*`

2. **Remove Duplicates**
   - `.pgn-moves::-webkit-scrollbar` appears in both files
   - Body styles duplicated

3. **BEM-like Naming Convention**
   - `.board` → `.board`, `.board__square`, `.board__piece`
   - `.panel` → `.panel`, `.panel__header`, `.panel__chart`

4. **Group Related Styles**
   - All animation `@keyframes` in one section
   - All responsive `@media` queries at end of file

---

## 3. TypeScript Backend Cleanup (Priority: Medium)

### lib/db.ts (300 lines)

**Extract Types:**
```
lib/
├── db.ts                  # Database operations only
├── db-types.ts            # All interfaces (DbUser, SessionRecord, etc.)
└── db-mappers.ts          # Row mapping functions
```

**Naming Consistency:**
- API uses snake_case (`total_moves`, `average_retries`)
- Internal code uses camelCase
- Keep this separation but document it clearly

**Improve Function Signatures:**
```typescript
// Before
export async function recordGameResult(args: {...}): Promise<void>

// After - explicit parameter names
export async function recordGameResult(params: RecordGameResultParams): Promise<void>
```

### lib/sessions.ts (109 lines)

- Rename `SessionCreationResult` → `CreateSessionResult`
- Add JSDoc comments explaining the session lifecycle
- Extract `FinalizeSessionInput` validation

### lib/precomputed.ts (136 lines)

- Rename `loadPrecomputedGames` → `getGames` (with internal caching)
- Add explicit return type annotations
- Document the PGN parsing logic

### lib/stats.ts (111 lines)

- Already clean, just add JSDoc comments

### lib/auth.ts (65 lines)

- Extract auth options to separate constant
- Document callback flow

---

## 4. API Routes Cleanup (Priority: Medium)

### Consistent Error Handling

Create shared utilities:
```typescript
// lib/api-utils.ts
export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
```

### Request/Response Types

Move interfaces to shared location:
```typescript
// types/api.ts
export interface SessionCreateRequest { ... }
export interface SessionCreateResponse { ... }
export interface CompletePayload { ... }
```

---

## 5. Component Architecture (Priority: Low)

### Current: 2 components
- `auth-controls.tsx` (133 lines) - Could split modal into separate component
- `providers.tsx` (9 lines) - Fine as is

### Potential Extractions
- `AuthModal` component from `auth-controls.tsx`
- `AvatarButton` component

---

## 6. Project Structure Improvements (Priority: Low)

### Move Legacy Files
```
public/legacy/           → Keep but document purpose
├── js/main.js          → After refactor: modular structure
├── css/main.css        → Consolidate into app/styles/
└── vendor/             → Keep (chess.js vendored)
```

### Add Index Exports
```typescript
// lib/index.ts
export * from './db';
export * from './sessions';
export * from './stats';
export * from './auth';
```

---

## 7. Code Quality Improvements

### Add JSDoc Comments
- All exported functions
- Complex logic sections
- Type definitions

### Consistent Formatting
- Single quotes for strings
- Semicolons everywhere or nowhere (pick one)
- Consistent spacing

### Remove Dead Code
- `submitCorrectMoveToServer()` - empty function
- `setWho()` - empty function
- Unused variables

### Improve Variable Names
- `SID` → `sessionId`
- `mv` → `move` or `moveUci`
- `g` → `game` in loops

---

## Execution Order

1. **Phase 1: main.js Decomposition** (largest impact)
   - Create module structure
   - Extract constants first
   - Move functions one module at a time
   - Test after each extraction

2. **Phase 2: CSS Consolidation**
   - Create new file structure
   - Move styles incrementally
   - Verify no visual changes

3. **Phase 3: TypeScript Cleanup**
   - Extract types
   - Add JSDoc comments
   - Improve naming

4. **Phase 4: API & Components**
   - Add shared utilities
   - Extract components

5. **Phase 5: Final Polish**
   - Remove dead code
   - Consistent formatting
   - Documentation

---

## Testing Strategy

After each phase:
1. Run `npm run lint` - verify no new errors
2. Run `npm run build` - verify compilation
3. Manual test: Start new game, make moves, verify charts
4. Verify no UI changes (visual regression)

---

## Files Affected

| File | Lines | Changes |
|------|-------|---------|
| `public/legacy/js/main.js` | 1394 | Split into 9 modules |
| `public/legacy/css/main.css` | 326 | Consolidate |
| `app/globals.css` | 456 | Consolidate |
| `lib/db.ts` | 300 | Extract types |
| `lib/sessions.ts` | 109 | Add docs, rename |
| `lib/precomputed.ts` | 136 | Add docs |
| `lib/auth.ts` | 65 | Extract config |
| API routes | 4 files | Shared utilities |
| Components | 2 files | Minor extractions |

**Total: ~3000 lines to refactor**
