import React from 'react';
import PropTypes from 'prop-types';
import HeadNext from 'next/head';

export default function HeadError({
  title,
}) {
  return (
    <HeadNext>
      <title>{`${title} | Polisense`}</title>
      <meta name="robots" content="noindex, follow" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </HeadNext>
  );
}

HeadError.defaultProps = {
  title: 'Something went wrong',
};

HeadError.propTypes = {
  title: PropTypes.string,
};
