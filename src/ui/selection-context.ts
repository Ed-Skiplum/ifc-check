/** The selection marks of the model a view belongs to (`selection-marks.ts`),
 *  provided once by `ModelPanel`, so a view deep in a board reads them
 *  without every board in between passing them on. Its own module, so a
 *  view importing it pulls in nothing else. */

import { createContext, useContext } from "react";
import { NO_MARKS, type SelectionMarks } from "./selection-marks";

export const SelectionMarksContext = createContext<SelectionMarks>(NO_MARKS);
export const useSelectionMarks = (): SelectionMarks => useContext(SelectionMarksContext);
