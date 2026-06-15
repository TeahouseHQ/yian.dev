import { parseISO, format } from "date-fns";

interface Props {
  isoDateString: string;
}

const DateFormatter = ({ isoDateString: dateString }: Props): React.JSX.Element => {
  const date = parseISO(dateString);
  return <time dateTime={dateString}>{format(date, "LLLL	d, yyyy")}</time>;
};

export default DateFormatter;
