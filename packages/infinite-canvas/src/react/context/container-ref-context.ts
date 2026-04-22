import { createContext, useContext } from 'react';

// Shared so WidgetSlot can compute container-relative pointer coordinates.
const ContainerRefContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

export const ContainerRefProvider = ContainerRefContext.Provider;

export function useContainerRef(): React.RefObject<HTMLDivElement | null> | null {
	return useContext(ContainerRefContext);
}
