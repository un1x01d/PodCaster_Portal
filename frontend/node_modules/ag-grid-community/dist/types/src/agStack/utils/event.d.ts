import type { UtilBeanCollection } from '../interfaces/agCoreBeanCollection';
export declare const _isEventSupported: (eventName: any) => boolean;
export declare function _isElementInEventPath(element: HTMLElement, event: Event): boolean;
export declare function _addSafePassiveEventListener(eElement: HTMLElement, event: string, listener: (event?: any) => void): void;
/**
 * `True` if the event is close to the original event by X pixels either vertically or horizontally.
 * we only start dragging after X pixels so this allows us to know if we should start dragging yet.
 * @param {MouseEvent | TouchEvent} e1
 * @param {MouseEvent | TouchEvent} e2
 * @param {number} pixelCount
 * @returns {boolean}
 */
export declare function _areEventsNear(e1: MouseEvent | Touch, e2: MouseEvent | Touch, pixelCount: number): boolean;
export declare function _isEventFromThisInstance(beans: UtilBeanCollection, event: UIEvent): boolean;
export declare function _anchorElementToMouseMoveEvent(element: HTMLElement, mouseMoveEvent: MouseEvent | Touch, beans: UtilBeanCollection): void;
