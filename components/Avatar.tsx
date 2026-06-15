import Image from "next/image";

import DateFormatter from "./DateFormatter";

interface Props {
  name: string;
  picture: string;
  date?: string;
}

const Avatar = ({ name, picture, date }: Props): React.JSX.Element => {
  return (
    <div className="flex items-center">
      <Image
        src={picture}
        className="w-12 h-12 rounded-full mr-4"
        width={48}
        height={48}
        alt={name}
      />
      <div>
        <div className="text-xl font-bold">{name}</div>
        <div className="text-red">{date && <DateFormatter isoDateString={date} />}</div>
      </div>
    </div>
  );
};

export default Avatar;
