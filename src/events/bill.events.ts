import { EventEmitter } from "events";

class BillEventEmitter extends EventEmitter { }

const billEvents = new BillEventEmitter();

export const BILL_EVENTS = {
    BILL_CREATED: "BILL_CREATED",
};

export default billEvents;
